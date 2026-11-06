"""Private, resumable podcast jobs and sentence captions from real PCM durations."""
import base64
import hashlib
import hmac
import io
import json
import os
import re
import sqlite3
import subprocess
import threading
import time
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from fastapi import HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator, model_validator

VOICE_IDS = {"aria", "nova", "jade", "echo", "atlas", "fable"}

class Turn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    speaker: StrictInt = Field(ge=0, le=1)
    text: str = Field(min_length=3, max_length=1200)

    @field_validator("text")
    @classmethod
    def whitespace(cls, value):
        value = re.sub(r"[\t\n\r\f\v \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+", " ", value).strip(" ")
        if len(value) < 3:
            raise ValueError("A dialogue turn is empty")
        return value

class DialogueRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    language: str = "en"
    voices: list[str] = Field(min_length=1, max_length=2)
    speed: float = Field(ge=0.75, le=1.25, allow_inf_nan=False)
    dialogue: list[Turn] = Field(min_length=1, max_length=80)

    @model_validator(mode="after")
    def valid_dialogue(self):
        if abs(self.speed * 100 - round(self.speed * 100)) > 1e-8:
            raise ValueError("Speed must use at most two decimal places")
        if self.language != "en" or any(voice not in VOICE_IDS for voice in self.voices):
            raise ValueError("Choose an available English voice")
        if len(set(self.voices)) != len(self.voices):
            raise ValueError("Two hosts require distinct voices")
        if any(turn.speaker >= len(self.voices) for turn in self.dialogue):
            raise ValueError("A speaker has no voice")
        if len(self.voices) == 2 and {turn.speaker for turn in self.dialogue} != {0, 1}:
            raise ValueError("The dialogue must include both hosts")
        if sum(len(turn.text) for turn in self.dialogue) > 40000:
            raise ValueError("The dialogue is too long")
        return self

def fingerprint(value):
    # Matches the frontend/backend JS schema, including positive half-up rounding.
    parts = [value.language, ",".join(value.voices), str(int(value.speed * 100 + 0.5))]
    parts.extend(f"{turn.speaker}:{turn.text}" for turn in value.dialogue)
    return hashlib.sha256("\n".join(parts).encode()).hexdigest()

def access_ticket(header):
    secret = os.environ.get("CLASSIO_TTS_SIGNING_SECRET", "")
    if len(secret) < 32:
        raise HTTPException(503, "Configure the shared podcast signing secret on both services.")
    try:
        if not header or not header.startswith("Bearer "):
            raise ValueError()
        body, signature = header[7:].split(".")
        expected = base64.urlsafe_b64encode(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest()).decode().rstrip("=")
        if not hmac.compare_digest(signature, expected):
            raise ValueError()
        claim = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        if not re.fullmatch(r"[a-f0-9]{64}", claim["o"]) or not re.fullmatch(r"[a-f0-9]{64}", claim["h"]):
            raise ValueError()
        if not isinstance(claim["exp"], int) or claim["exp"] <= time.time() or claim["exp"] > time.time() + 660:
            raise ValueError()
        return claim
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        raise HTTPException(401, "Podcast access expired or is invalid. Retry from Classio.")

def sentences(text):
    # A caption is synthesized as a complete phrase; its duration is measured,
    # never guessed from word count. Avoid splits at common titles/abbreviations.
    phrases = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"“])", text)
    output = []
    for phrase in phrases:
        if output and re.search(r"\b(?:Mr|Mrs|Ms|Dr|Prof|St|e\.g|i\.e)\.$", output[-1]):
            output[-1] += " " + phrase
        else:
            output.append(phrase)
    return output

def pcm(audio, target_rate=22050):
    with wave.open(io.BytesIO(audio), "rb") as source:
        if source.getsampwidth() != 2:
            raise ValueError("Unsupported PCM encoding")
        frames = np.frombuffer(source.readframes(source.getnframes()), dtype="<i2").astype(np.float32) / 32768
        channels, rate = source.getnchannels(), source.getframerate()
    if channels > 1:
        frames = frames.reshape(-1, channels).mean(axis=1)
    if not len(frames) or rate <= 0:
        raise ValueError("An audio segment is empty")
    if rate != target_rate:
        count = round(len(frames) * target_rate / rate)
        frames = np.interp(np.arange(count) * rate / target_rate, np.arange(len(frames)), frames)
    audible = np.flatnonzero(np.abs(frames) > 0.002)
    if not len(audible):
        raise ValueError("An audio segment is silent")
    frames = frames[max(0, int(audible[0]) - round(target_rate * 0.03)):min(len(frames), int(audible[-1]) + round(target_rate * 0.05))]
    fade = min(round(target_rate * 0.006), len(frames) // 2)
    if fade:
        frames[:fade] *= np.linspace(0, 1, fade)
        frames[-fade:] *= np.linspace(1, 0, fade)
    peak = float(np.max(np.abs(frames)))
    rms = float(np.sqrt(np.mean(frames ** 2)))
    if peak:
        gain = min(1.5, 0.12 / max(rms, 0.001), 0.94 / peak)
        frames = frames * gain
    return frames.astype(np.float32)

class JobStore:
    def __init__(self, directory, synthesize):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.database = self.directory / "jobs.sqlite3"
        self.synthesize = synthesize
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="classio-podcast")
        self.lock = threading.Lock()
        self.active = set()
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, owner TEXT, hash TEXT, status TEXT, payload TEXT, completed INTEGER, total INTEGER, metadata TEXT, error TEXT, updated REAL)")
        os.chmod(self.database, 0o600)

    def connect(self):
        db = sqlite3.connect(self.database, timeout=15)
        db.row_factory = sqlite3.Row
        return db

    def cleanup(self):
        cutoff = time.time() - max(3600, int(os.environ.get("PODCAST_CACHE_TTL_SECONDS", "86400")))
        with self.connect() as db:
            rows = db.execute("SELECT id FROM jobs WHERE updated<? AND status IN ('complete','failed')", (cutoff,)).fetchall()
            for row in rows:
                for extension in ("wav", "m4a"):
                    (self.directory / (row["id"] + "." + extension)).unlink(missing_ok=True)
            db.execute("DELETE FROM jobs WHERE updated<? AND status IN ('complete','failed')", (cutoff,))

    def resume(self):
        self.cleanup()
        with self.connect() as db:
            identities = [row[0] for row in db.execute("SELECT id FROM jobs WHERE status IN ('queued','generating') ORDER BY updated LIMIT 8")]
        for identity in identities:
            with self.lock:
                if identity not in self.active:
                    self.active.add(identity)
                    self.executor.submit(self.run, identity)

    def read(self, identity):
        with self.connect() as db:
            value = db.execute("SELECT * FROM jobs WHERE id=?", (identity,)).fetchone()
            return dict(value) if value else None

    def update(self, identity, **fields):
        fields["updated"] = time.time()
        with self.connect() as db:
            db.execute("UPDATE jobs SET " + ",".join(name + "=?" for name in fields) + " WHERE id=?", [*fields.values(), identity])

    def create(self, value, claim):
        self.cleanup()
        digest = fingerprint(value)
        if digest != claim["h"]:
            raise HTTPException(403, "This ticket belongs to a different podcast request.")
        identity = hashlib.sha256((claim["o"] + digest).encode()).hexdigest()
        with self.lock:
            previous = self.read(identity)
            if previous and previous["status"] == "complete":
                metadata = json.loads(previous["metadata"])
                if (self.directory / metadata["filename"]).is_file():
                    return identity
            if identity in self.active:
                return identity
            with self.connect() as db:
                pending = db.execute("SELECT COUNT(*) FROM jobs WHERE status IN ('queued','generating') AND updated>?", (time.time() - 3600,)).fetchone()[0]
                owned = db.execute("SELECT COUNT(*) FROM jobs WHERE owner=? AND status IN ('queued','generating') AND updated>?", (claim["o"], time.time() - 3600)).fetchone()[0]
                if pending >= 8 or owned >= 2:
                    raise HTTPException(429, "The voice queue is full. Your script is kept; retry shortly.", headers={"Retry-After": "20"})
                db.execute("INSERT OR REPLACE INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?)", (identity, claim["o"], digest, "queued", value.model_dump_json(), 0, len(value.dialogue), None, None, time.time()))
            self.active.add(identity)
            self.executor.submit(self.run, identity)
        return identity

    def run(self, identity):
        try:
            record = self.read(identity)
            value = DialogueRequest.model_validate_json(record["payload"])
            self.update(identity, status="generating", completed=0)
            rate, cursor, captions = 22050, 0, []
            hop, envelope, tail, peak = round(rate / 10), [], np.zeros(0, dtype=np.float32), 0.0
            wav_path = self.directory / (identity + ".wav")
            with wave.open(str(wav_path), "wb") as output:
                output.setparams((1, 2, rate, 0, "NONE", "not compressed"))
                def append_frames(frames):
                    nonlocal cursor, tail, peak
                    if cursor + len(frames) > rate * 25 * 60:
                        raise ValueError("Podcast duration exceeded")
                    cursor += len(frames)
                    peak = max(peak, float(np.max(np.abs(frames))))
                    output.writeframes((np.clip(frames, -0.98, 0.98) * 32767).astype("<i2").tobytes())
                    window = np.concatenate((tail, frames))
                    complete = len(window) // hop * hop
                    if complete:
                        rms = np.sqrt(np.mean(window[:complete].reshape(-1, hop) ** 2, axis=1))
                        envelope.extend(round(min(1, float(level) * 6), 3) for level in rms)
                    tail = window[complete:].copy()
                for index, turn in enumerate(value.dialogue):
                    for phrase in sentences(turn.text):
                        frames = pcm(self.synthesize(phrase, value.voices[turn.speaker], value.speed), rate)
                        start = cursor / rate
                        append_frames(frames)
                        captions.append({"speaker": turn.speaker, "turn": index, "text": phrase, "start": round(start, 6), "end": round(cursor / rate, 6)})
                        append_frames(np.zeros(round(rate * 0.14), dtype=np.float32))
                    if index + 1 < len(value.dialogue) and value.dialogue[index + 1].speaker != turn.speaker:
                        append_frames(np.zeros(round(rate * 0.12), dtype=np.float32))
                    self.update(identity, completed=index + 1)
            if len(tail):
                envelope.append(round(min(1, float(np.sqrt(np.mean(tail ** 2))) * 6), 3))
            os.chmod(wav_path, 0o600)
            m4a_path = self.directory / (identity + ".m4a")
            try:
                subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(wav_path), "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", "-y", str(m4a_path)], check=True, timeout=120, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                filename, mime = m4a_path.name, "audio/mp4"
                os.chmod(m4a_path, 0o600)
                wav_path.unlink()
            except (OSError, subprocess.SubprocessError):
                m4a_path.unlink(missing_ok=True)
                filename, mime = wav_path.name, "audio/wav"
            metadata = {"filename": filename, "mime": mime, "duration": round(cursor / rate, 6), "sampleRate": rate, "captions": captions, "envelope": envelope, "envelopeStep": 0.1, "voices": value.voices, "language": "en", "peak": round(peak, 4), "alignment": "synthesized-phrase-boundaries"}
            self.update(identity, status="complete", metadata=json.dumps(metadata), completed=len(value.dialogue), payload="{}", error=None)
        except Exception as error:
            # No script, tokens, model URLs or exception details in public output/logs.
            print("[Podcast] Job failed:", type(error).__name__)
            for extension in ("wav", "m4a"):
                (self.directory / (identity + "." + extension)).unlink(missing_ok=True)
            self.update(identity, status="failed", error="Audio generation failed. Your script is kept. Retry from Classio.")
        finally:
            with self.lock:
                self.active.discard(identity)

    def authorized(self, identity, claim):
        if not re.fullmatch(r"[a-f0-9]{64}", identity):
            raise HTTPException(404, "Podcast not found.")
        record = self.read(identity)
        if not record or not hmac.compare_digest(record["owner"], claim["o"]) or not hmac.compare_digest(record["hash"], claim["h"]):
            raise HTTPException(404, "Podcast not found.")
        return record

    def public(self, record):
        value = {"id": record["id"], "status": record["status"], "completedTurns": record["completed"], "totalTurns": record["total"]}
        if record["status"] == "complete":
            metadata = json.loads(record["metadata"])
            value["audio"] = "/podcasts/jobs/" + record["id"] + "/audio"
            value["metadata"] = {key: item for key, item in metadata.items() if key != "filename"}
        if record["status"] == "failed":
            value["error"] = record["error"]
        return value

def install_routes(app, synthesize):
    store = JobStore(os.environ.get("PODCAST_DATA_DIR", "/tmp/classio-podcasts"), synthesize)

    # Preserve any existing application lifespan and restore pending work once.
    from contextlib import asynccontextmanager
    previous_lifespan = app.router.lifespan_context
    @asynccontextmanager
    async def lifespan(application):
        async with previous_lifespan(application):
            store.resume()
            yield
    app.router.lifespan_context = lifespan

    @app.post("/podcasts/jobs", status_code=202)
    def create_job(value: DialogueRequest, request: Request):
        claim = access_ticket(request.headers.get("Authorization"))
        identity = store.create(value, claim)
        return store.public(store.authorized(identity, claim))

    @app.get("/podcasts/jobs/{identity}")
    def job_status(identity: str, request: Request):
        return store.public(store.authorized(identity, access_ticket(request.headers.get("Authorization"))))

    @app.get("/podcasts/jobs/{identity}/audio")
    def job_audio(identity: str, request: Request):
        record = store.authorized(identity, access_ticket(request.headers.get("Authorization")))
        if record["status"] != "complete":
            raise HTTPException(409, "Audio is not ready yet.")
        metadata = json.loads(record["metadata"])
        return FileResponse(store.directory / metadata["filename"], media_type=metadata["mime"], headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})

    @app.get("/podcasts/capabilities")
    def capabilities():
        return {"hosts": [1, 2], "audioLanguages": ["en"], "captionAlignment": "synthesized-phrase-boundaries", "persistentJobs": True, "ticketRequired": True, "quality": os.environ.get("CLASSIO_VOICE_QUALITY", "medium"), "configured": len(os.environ.get("CLASSIO_TTS_SIGNING_SECRET", "")) >= 32}

    return store

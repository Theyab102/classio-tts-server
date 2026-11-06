"""
Classio TTS Server — Piper TTS via FastAPI
Deploy to Render.com as a Web Service
"""

import os
import io
import wave
import urllib.request
import hashlib
import json
import shutil
import tempfile
import threading
from collections import OrderedDict
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

app = FastAPI(title="Classio TTS Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[value.strip() for value in os.environ.get("CLASSIO_ALLOWED_ORIGINS", "https://classio-eta.vercel.app,http://localhost:3000,http://127.0.0.1:3000").split(",") if value.strip()],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)

@app.middleware("http")
async def limit_request_body(request: Request, call_next):
    # Bound JSON parsing before validated, ticket-scoped handlers run.
    if request.method == "POST":
        try:
            if int(request.headers.get("content-length", "0")) > 1000000:
                return JSONResponse({"detail":"Request is too large."}, status_code=413)
        except ValueError:
            return JSONResponse({"detail":"Invalid request length."}, status_code=400)
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 1000000:
                return JSONResponse({"detail":"Request is too large."}, status_code=413)
        request._body = bytes(body)
    return await call_next(request)

# ── Verified voice paths from HuggingFace rhasspy/piper-voices (main branch) ──
VOICES = {
    "aria":  {"label":"Aria",  "gender":"female","desc":"Warm & natural",   "hf":"en/en_US/lessac/medium/en_US-lessac-medium.onnx"},
    "nova":  {"label":"Nova",  "gender":"female","desc":"Bright & clear",   "hf":"en/en_US/amy/medium/en_US-amy-medium.onnx"},
    "jade":  {"label":"Jade",  "gender":"female","desc":"Calm & smooth",    "hf":"en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium.onnx"},
    "echo":  {"label":"Echo",  "gender":"male",  "desc":"Deep & confident", "hf":"en/en_US/ryan/medium/en_US-ryan-medium.onnx"},
    "atlas": {"label":"Atlas", "gender":"male",  "desc":"Bold & clear",     "hf":"en/en_GB/alan/medium/en_GB-alan-medium.onnx"},
    "fable": {"label":"Fable", "gender":"male",  "desc":"Friendly & warm",  "hf":"en/en_US/joe/medium/en_US-joe-medium.onnx"},
}

MODELS_DIR = Path(os.environ.get("MODELS_DIR", "/tmp/piper-models"))
MODELS_DIR.mkdir(parents=True, exist_ok=True)

# Match the release catalog and checksums bundled with Piper 1.2.0.
HF_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0"

VOICE_QUALITY = os.environ.get("CLASSIO_VOICE_QUALITY", "medium")
if VOICE_QUALITY not in {"medium", "high"}:
    raise RuntimeError("CLASSIO_VOICE_QUALITY must be medium or high")
if VOICE_QUALITY == "high":
    for voice in ("aria", "echo"):
        VOICES[voice]["hf"] = VOICES[voice]["hf"].replace("/medium/", "/high/").replace("-medium.onnx", "-high.onnx")
for metadata in VOICES.values():
    metadata["quality"] = "high" if "/high/" in metadata["hf"] else "medium"
_voice_cache = OrderedDict()
_model_cache_lock = threading.Lock()
_voice_locks = {voice: threading.Lock() for voice in VOICES}
_synthesis_slots = threading.BoundedSemaphore(2)


def model_files(voice_id):
    # The installed Piper distribution contains the publisher's expected sizes
    # and checksums. Unknown or changed artifacts fail closed.
    import piper
    manifest = json.loads(Path(piper.__file__).with_name("voices.json").read_text())
    entries = {name: info for voice in manifest.values() for name, info in voice["files"].items()}
    path = VOICES[voice_id]["hf"]
    return {name: entries[name] for name in (path, path + ".json", str(Path(path).parent / "MODEL_CARD"))}


def verified(path, expected):
    if not path.is_file() or path.stat().st_size != expected["size_bytes"]:
        return False
    digest = hashlib.md5()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest() == expected["md5_digest"]


def model_target(name, voice_id):
    return MODELS_DIR / (voice_id + ".MODEL_CARD" if Path(name).name == "MODEL_CARD" else Path(name).name)


def ensure_model(voice_id):
    files = model_files(voice_id)
    if all(verified(model_target(name, voice_id), expected) for name, expected in files.items()):
        return MODELS_DIR / Path(VOICES[voice_id]["hf"]).name
    temporary = []
    try:
        for name, expected in files.items():
            with tempfile.NamedTemporaryFile(dir=MODELS_DIR, suffix=".part", delete=False) as destination:
                path = Path(destination.name)
                temporary.append((path, model_target(name, voice_id)))
                with urllib.request.urlopen(f"{HF_BASE}/{name}?download=true", timeout=30) as response:
                    shutil.copyfileobj(response, destination)
            if not verified(path, expected):
                raise RuntimeError("Model checksum verification failed")
        # Do not publish a partial pair after a failed download.
        for source, target in temporary:
            os.replace(source, target)
    finally:
        for source, _target in temporary:
            source.unlink(missing_ok=True)
    return MODELS_DIR / Path(VOICES[voice_id]["hf"]).name


def get_voice(voice_id: str):
    with _voice_locks[voice_id], _model_cache_lock:
        if voice_id not in _voice_cache:
            # Keep at most the two conversation voices loaded. Long podcasts
            # stream to disk instead of retaining their full PCM in memory.
            while len(_voice_cache) >= 2:
                _voice_cache.popitem(last=False)
            from piper import PiperVoice
            _voice_cache[voice_id] = PiperVoice.load(str(ensure_model(voice_id)))
        _voice_cache.move_to_end(voice_id)
        return _voice_cache[voice_id]


def synthesize_wav(text: str, voice_id: str, speed: float = 1.0) -> bytes:
    voice = get_voice(voice_id)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        voice.synthesize(
            text, wav_file,
            length_scale=round(1.0 / max(speed, 0.1), 3),
            sentence_silence=0.3,
        )
    return buf.getvalue()


class TTSRequest(BaseModel):
    text:  str
    voice: str   = "aria"
    speed: float = 1.0


@app.get("/")
def root():
    return {"status": "ok", "service": "Classio TTS", "voices": list(VOICES.keys())}

@app.get("/voices")
def list_voices():
    return {vid: {k:v for k,v in vdata.items() if k != "hf"} for vid, vdata in VOICES.items()}

@app.get("/health")
def health():
    return {"status": "healthy"}

def bounded_synthesis(text, voice, speed):
    if not _synthesis_slots.acquire(blocking=False):
        raise HTTPException(429, "The voice service is busy. Retry shortly.", headers={"Retry-After": "10"})
    try:
        return synthesize_wav(text, voice, speed)
    finally:
        _synthesis_slots.release()


from podcast_jobs import install_routes
podcast_jobs = install_routes(app, synthesize_wav)


@app.post("/generate-podcast")
async def generate_podcast(req: TTSRequest):
    if os.environ.get("CLASSIO_ALLOW_LEGACY_TTS", "false") != "true":
        raise HTTPException(410, "Use Classio’s authenticated podcast job endpoint.")
    if not req.text or len(req.text.strip()) < 5:
        raise HTTPException(400, "Text too short")
    if len(req.text) > 50000:
        raise HTTPException(400, "Text too long")
    if req.voice not in VOICES:
        raise HTTPException(400, "Unknown voice. Choose an available voice.")
    if not 0.5 <= req.speed <= 3.0:
        raise HTTPException(400, "Choose a speed between 0.5 and 3.")
    try:
        audio = await run_in_threadpool(bounded_synthesis, req.text, req.voice, req.speed)
        return Response(content=audio, media_type="audio/wav", headers={"Cache-Control": "private, no-store"})
    except HTTPException:
        raise
    except Exception as error:
        # Log the category only; upstream URLs, internals and content stay private.
        print(f"[TTS] Synthesis failed: {type(error).__name__}")
        raise HTTPException(503, "Audio generation is temporarily unavailable. Your script is unchanged; retry shortly.")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))

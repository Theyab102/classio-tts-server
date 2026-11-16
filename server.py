"""
Classio TTS Server — Piper TTS via FastAPI
Deploy to Render.com as a Web Service
"""

import os
import io
import wave
import urllib.request
import tempfile
import threading
import logging
import time
import secrets
import hashlib
import hmac
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

app = FastAPI(title="Classio TTS Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.environ.get("CLASSIO_ALLOWED_ORIGINS", "https://classio-eta.vercel.app,http://localhost:3000,http://127.0.0.1:3000").split(",") if origin.strip()],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)

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

# Use main branch — v1.0.0 tag is missing some voices
HF_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main"

_voice_cache = {}
_model_lock = threading.Lock()
_generation_slots = threading.BoundedSemaphore(2)
_request_lock = threading.Lock()
_requests = {}
_rate_secret = secrets.token_bytes(32)
logger = logging.getLogger("classio.tts")


class BodyLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST":
            return await self.app(scope, receive, send)
        messages, size = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            size += len(message.get("body", b""))
            if size > 220000:
                await send({"type": "http.response.start", "status": 413, "headers": [(b"content-type", b"application/json"), (b"cache-control", b"no-store")]})
                await send({"type": "http.response.body", "body": b'{"detail":"This speech request is too large."}'})
                return
            messages.append(message)
            if not message.get("more_body", False):
                break
        async def replay():
            return messages.pop(0) if messages else await receive()
        await self.app(scope, replay, send)


app.add_middleware(BodyLimit)


def get_voice(voice_id: str):
    with _model_lock:
        if voice_id in _voice_cache:
            return _voice_cache[voice_id]
        from piper import PiperVoice
        hf_path = VOICES[voice_id]["hf"]
        model_name = Path(hf_path).stem
        onnx_path = MODELS_DIR / f"{model_name}.onnx"
        json_path = MODELS_DIR / f"{model_name}.onnx.json"
        if not onnx_path.exists() or not json_path.exists():
            # Publish complete pairs only; a failed download never becomes a
            # cached model that breaks every subsequent request.
            with tempfile.TemporaryDirectory(dir=MODELS_DIR) as temporary:
                for suffix in (".onnx", ".onnx.json"):
                    target = Path(temporary) / (model_name + suffix)
                    url = f"{HF_BASE}/{hf_path}{'.json' if suffix.endswith('.json') else ''}?download=true"
                    size = 0
                    with urllib.request.urlopen(url, timeout=40) as response, target.open("wb") as output:
                        while chunk := response.read(1024 * 1024):
                            size += len(chunk)
                            if size > 100 * 1024 * 1024:
                                raise ValueError("Voice artifact exceeds size limit")
                            output.write(chunk)
                    if not size:
                        raise ValueError("Empty voice artifact")
                (Path(temporary) / (model_name + ".onnx.json")).replace(json_path)
                (Path(temporary) / (model_name + ".onnx")).replace(onnx_path)
        voice = PiperVoice.load(str(onnx_path))
        _voice_cache[voice_id] = voice
        return voice


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
    text: str = Field(min_length=5, max_length=5000)
    voice: str = Field(default="aria", max_length=20)
    speed: float = Field(default=1.0, ge=0.5, le=3.0, allow_inf_nan=False)


@app.get("/")
def root():
    return {"status": "ok", "service": "Classio TTS", "voices": list(VOICES.keys())}

@app.get("/voices")
def list_voices():
    return {vid: {k:v for k,v in vdata.items() if k != "hf"} for vid, vdata in VOICES.items()}

@app.get("/health")
def health():
    return {"status": "healthy"}

@app.post("/generate-podcast")
def generate_podcast(req: TTSRequest, request: Request):
    if not req.text or len(req.text.strip()) < 5:
        raise HTTPException(400, "Text too short")
    if len(req.text) > 50000:
        raise HTTPException(400, "Text too long")
    if req.voice not in VOICES:
        raise HTTPException(400, f"Unknown voice. Use: {list(VOICES.keys())}")

    speed = max(0.5, min(req.speed, 3.0))

    # Per-instance limits bound public CPU use. Apply deployment-wide limits
    # at the hosting proxy as well when running multiple instances.
    now = time.monotonic()
    address = request.client.host if request.client else "unknown"
    client = hmac.new(_rate_secret, address.encode(), hashlib.sha256).hexdigest()
    with _request_lock:
        for key in list(_requests):
            if _requests[key][0] + 60 <= now:
                del _requests[key]
        for key, limit in (("client:" + client, 8), ("all", 60)):
            if _requests.get(key, (now, 0))[1] >= limit:
                raise HTTPException(429, "Speech request limit reached. Try again in a minute.", headers={"Retry-After": "60"})
        if len(_requests) >= 5000:
            raise HTTPException(503, "Speech is busy. Try again shortly.")
        for key in ("client:" + client, "all"):
            start, count = _requests.get(key, (now, 0))
            _requests[key] = (start, count + 1)
    if not _generation_slots.acquire(blocking=False):
        raise HTTPException(429, "Speech is busy. Try again shortly.", headers={"Retry-After": "10"})
    try:
        print(f"[TTS] voice={req.voice} speed={speed} chars={len(req.text)}")
        audio = synthesize_wav(req.text, req.voice, speed)
        print(f"[TTS] Done: {len(audio):,} bytes")
        return Response(
            content=audio,
            media_type="audio/wav",
            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
        )
    except Exception as error:
        logger.warning("Speech generation failed: %s", type(error).__name__)
        raise HTTPException(503, "Speech could not be generated. Try again shortly; your transcript is kept.") from None
    finally:
        _generation_slots.release()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))

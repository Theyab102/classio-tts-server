"""
Classio TTS Server — Piper TTS via FastAPI
Deploy to Render.com as a Web Service
"""

import os
import io
import uuid
import json
import struct
import hashlib
import tempfile
import subprocess
import urllib.request
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

app = FastAPI(title="Classio TTS Server")

# ── CORS — allow Vercel frontend ──────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tighten to your vercel URL in production if you want
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)

# ── Voice definitions ─────────────────────────────────────────────────────────
# Each entry: display label, piper model name, HuggingFace file path, gender
VOICES = {
    "aria":  {
        "label": "Aria",   "gender": "female", "desc": "Warm & natural",
        "model": "en_US-jenny_dioco-medium",
        "hf":    "en/en_US/jenny_dioco/medium/en_US-jenny_dioco-medium.onnx",
    },
    "nova":  {
        "label": "Nova",   "gender": "female", "desc": "Bright & clear",
        "model": "en_US-kusal-medium",
        "hf":    "en/en_US/kusal/medium/en_US-kusal-medium.onnx",
    },
    "jade":  {
        "label": "Jade",   "gender": "female", "desc": "Calm & smooth",
        "model": "en_US-lessac-medium",
        "hf":    "en/en_US/lessac/medium/en_US-lessac-medium.onnx",
    },
    "echo":  {
        "label": "Echo",   "gender": "male",   "desc": "Deep & confident",
        "model": "en_US-ryan-medium",
        "hf":    "en/en_US/ryan/medium/en_US-ryan-medium.onnx",
    },
    "atlas": {
        "label": "Atlas",  "gender": "male",   "desc": "Bold & clear",
        "model": "en_US-joe-medium",
        "hf":    "en/en_US/joe/medium/en_US-joe-medium.onnx",
    },
    "fable": {
        "label": "Fable",  "gender": "male",   "desc": "Friendly & warm",
        "model": "en_US-danny-low",
        "hf":    "en/en_US/danny/low/en_US-danny-low.onnx",
    },
}

# ── Voice model cache directory ───────────────────────────────────────────────
MODELS_DIR = Path(os.environ.get("MODELS_DIR", "/tmp/piper-models"))
MODELS_DIR.mkdir(parents=True, exist_ok=True)

HF_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0"


def get_model_path(voice_id: str) -> Path:
    """Download voice model if not cached, return path to .onnx file."""
    voice = VOICES.get(voice_id)
    if not voice:
        raise ValueError(f"Unknown voice: {voice_id}")

    model_name = voice["model"]
    onnx_path  = MODELS_DIR / f"{model_name}.onnx"
    json_path  = MODELS_DIR / f"{model_name}.onnx.json"

    if not onnx_path.exists():
        print(f"[TTS] Downloading voice model: {model_name}...")
        hf_onnx = f"{HF_BASE}/{voice['hf']}"
        hf_json = hf_onnx + ".json"
        urllib.request.urlretrieve(hf_onnx, onnx_path)
        urllib.request.urlretrieve(hf_json, json_path)
        print(f"[TTS] Downloaded: {onnx_path}")

    return onnx_path


def generate_wav(text: str, voice_id: str, speed: float = 1.0) -> bytes:
    """Run piper CLI and return WAV bytes."""
    onnx_path = get_model_path(voice_id)
    length_scale = round(1.0 / max(speed, 0.1), 3)  # piper uses length_scale (inverse of speed)

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        out_path = tmp.name

    try:
        result = subprocess.run(
            [
                "piper",
                "--model",        str(onnx_path),
                "--output_file",  out_path,
                "--length_scale", str(length_scale),
                "--sentence_silence", "0.3",
            ],
            input=text.encode("utf-8"),
            capture_output=True,
            timeout=120,
        )
        if result.returncode != 0:
            err = result.stderr.decode("utf-8", errors="replace")
            raise RuntimeError(f"Piper failed: {err}")

        with open(out_path, "rb") as f:
            return f.read()
    finally:
        try:
            os.unlink(out_path)
        except Exception:
            pass


def wav_to_mp3(wav_bytes: bytes) -> bytes:
    """Convert WAV to MP3 using ffmpeg (smaller file, faster transfer)."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as wav_tmp:
        wav_tmp.write(wav_bytes)
        wav_path = wav_tmp.name

    mp3_path = wav_path.replace(".wav", ".mp3")

    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", wav_path, "-codec:a", "libmp3lame",
             "-qscale:a", "4", "-ar", "22050", mp3_path],
            capture_output=True,
            timeout=60,
            check=True,
        )
        with open(mp3_path, "rb") as f:
            return f.read()
    except (subprocess.CalledProcessError, FileNotFoundError):
        # ffmpeg not available — return WAV
        return wav_bytes
    finally:
        for p in [wav_path, mp3_path]:
            try:
                os.unlink(p)
            except Exception:
                pass


# ── Request models ────────────────────────────────────────────────────────────
class TTSRequest(BaseModel):
    text:     str
    voice:    str  = "aria"
    speed:    float = 1.0
    format:   str  = "mp3"   # "mp3" or "wav"


# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {"status": "ok", "service": "Classio TTS", "voices": list(VOICES.keys())}


@app.get("/voices")
def list_voices():
    return {
        vid: {k: v for k, v in vdata.items() if k != "hf"}
        for vid, vdata in VOICES.items()
    }


@app.post("/generate-podcast")
async def generate_podcast(req: TTSRequest):
    """Generate full podcast audio from text. Returns audio/mpeg or audio/wav."""
    if not req.text or len(req.text.strip()) < 5:
        raise HTTPException(400, "Text too short")
    if len(req.text) > 50000:
        raise HTTPException(400, "Text too long (max 50,000 chars)")
    if req.voice not in VOICES:
        raise HTTPException(400, f"Unknown voice '{req.voice}'. Use: {list(VOICES.keys())}")

    speed = max(0.5, min(req.speed, 3.0))

    try:
        print(f"[TTS] Generating: voice={req.voice}, speed={speed}, chars={len(req.text)}")
        wav = generate_wav(req.text, req.voice, speed)

        if req.format == "mp3":
            audio = wav_to_mp3(wav)
            content_type = "audio/mpeg"
        else:
            audio = wav
            content_type = "audio/wav"

        print(f"[TTS] Done: {len(audio):,} bytes ({content_type})")
        return Response(
            content=audio,
            media_type=content_type,
            headers={
                "Content-Disposition": "inline",
                "Cache-Control": "public, max-age=3600",
                "X-Audio-Duration-Hint": str(len(req.text) // 15),  # rough seconds estimate
            },
        )
    except Exception as e:
        print(f"[TTS] Error: {e}")
        raise HTTPException(500, str(e))


@app.get("/health")
def health():
    """Render health check endpoint."""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)

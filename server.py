"""
Classio TTS Server — Piper TTS via FastAPI
Deploy to Render.com as a Web Service
"""

import os
import io
import wave
import urllib.request
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

app = FastAPI(title="Classio TTS Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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


def get_voice(voice_id: str):
    if voice_id in _voice_cache:
        return _voice_cache[voice_id]

    from piper import PiperVoice

    info = VOICES[voice_id]
    hf_path = info["hf"]
    model_name = Path(hf_path).stem   # e.g. en_US-lessac-medium
    onnx_path = MODELS_DIR / f"{model_name}.onnx"
    json_path = MODELS_DIR / f"{model_name}.onnx.json"

    if not onnx_path.exists():
        print(f"[TTS] Downloading {model_name}...")
        onnx_url = f"{HF_BASE}/{hf_path}?download=true"
        json_url = f"{HF_BASE}/{hf_path}.json?download=true"
        urllib.request.urlretrieve(onnx_url, onnx_path)
        urllib.request.urlretrieve(json_url, json_path)
        print(f"[TTS] Downloaded {onnx_path} ({onnx_path.stat().st_size:,} bytes)")

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

@app.post("/generate-podcast")
async def generate_podcast(req: TTSRequest):
    if not req.text or len(req.text.strip()) < 5:
        raise HTTPException(400, "Text too short")
    if len(req.text) > 50000:
        raise HTTPException(400, "Text too long")
    if req.voice not in VOICES:
        raise HTTPException(400, f"Unknown voice. Use: {list(VOICES.keys())}")

    speed = max(0.5, min(req.speed, 3.0))

    try:
        print(f"[TTS] voice={req.voice} speed={speed} chars={len(req.text)}")
        audio = synthesize_wav(req.text, req.voice, speed)
        print(f"[TTS] Done: {len(audio):,} bytes")
        return Response(
            content=audio,
            media_type="audio/wav",
            headers={"Cache-Control": "public, max-age=3600"},
        )
    except Exception as e:
        print(f"[TTS] Error: {e}")
        raise HTTPException(500, str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))

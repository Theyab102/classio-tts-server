Classio TTS Server (Hugging Face Version)

Neural TTS backend for Classio using Piper TTS + Hugging Face models.

Voices included
ID	Name	Gender	Description
aria	Aria	Female	Warm & natural
nova	Nova	Female	Bright & clear
jade	Jade	Female	Calm & smooth
echo	Echo	Male	Deep & confident
atlas	Atlas	Male	Bold & clear
fable	Fable	Male	Friendly & warm
How it works (NEW)
Voice models are downloaded from Hugging Face
No Render deployment needed
Backend runs locally OR on any server you choose
Models are cached after first use
Setup (Simple)
1 — Install dependencies
pip install -r requirements.txt

Also install system packages:

sudo apt-get install espeak-ng ffmpeg
2 — Run the server
uvicorn server:app --host 0.0.0.0 --port 8000

Server will run on:

http://localhost:8000
3 — Connect to Classio frontend

In your public/index.html:

<script>
  window.__CLASSIO_TTS_URL__ = "http://localhost:8000";
</script>
Model Download (Hugging Face)
First time you use a voice → model downloads (~80MB)
Stored locally (auto cache)
Next requests are fast

If you want manual control, you can use:

from huggingface_hub import hf_hub_download

hf_hub_download(repo_id="rhasspy/piper-voices", filename="aria.onnx")
API
POST /generate-podcast

Request:

{
  "text": "Your podcast script here...",
  "voice": "aria",
  "speed": 1.0,
  "format": "mp3"
}

Response: Audio file

GET /voices

Returns all available voices

GET /health
{"status": "healthy"}
Notes (Updated)
No cold starts (unlike Render)
First request downloads model (~20–30s)
After that: fast generation (~5–15s)
Speed is applied during generation (not live)
Optional (Deploy later if you want)

You can still deploy this to:

VPS (Linux server)
Docker
Any cloud (AWS, etc.)
Local test
curl -X POST http://localhost:8000/generate-podcast \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello, this is Classio.", "voice": "aria"}' \
  --output test.mp3

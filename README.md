# Classio TTS Server (Hugging Face Version)

Neural TTS backend for Classio using Piper TTS + Hugging Face models.

---

## Voices Included

| ID    | Name  | Gender | Description        |
|-------|-------|--------|-------------------|
| aria  | Aria  | Female | Warm & natural     |
| nova  | Nova  | Female | Bright & clear     |
| jade  | Jade  | Female | Calm & smooth      |
| echo  | Echo  | Male   | Deep & confident   |
| atlas | Atlas | Male   | Bold & clear       |
| fable | Fable | Male   | Friendly & warm    |

---

## How it Works

- Voice models are downloaded from Hugging Face
- No Render deployment needed
- Backend runs locally or on any server
- Models are cached after first use

---

## Setup

### 1 — Install dependencies

```bash
pip install -r requirements.txt
```
Install system packages:
```
sudo apt-get install espeak-ng ffmpeg
```
2 — Run the server
```
uvicorn server:app --host 0.0.0.0 --port 8000
```
Server runs on:

http://localhost:8000

3 — Connect to Classio frontend

In public/index.html:
```
<script>
  window.__CLASSIO_TTS_URL__ = "http://localhost:8000";
</script>
```
Model Download (Hugging Face)
First use → downloads model (~80MB)
Stored locally (auto cached)
Future requests are fast

Manual download example:
```
from huggingface_hub import hf_hub_download

hf_hub_download(
  repo_id="rhasspy/piper-voices",
  filename="aria.onnx"
)
```
API
POST /generate-podcast

Request:
```
{
  "text": "Your podcast script here...",
  "voice": "aria",
  "speed": 1.0,
  "format": "mp3"
}
```
Response: Audio file

GET /voices

Returns all available voices

GET /health
```
{"status": "healthy"}
```
Notes
No cold starts (unlike Render)
First request: ~20–30s (model download)
After that: ~5–15s
Speed is applied during generation
Optional Deployment

You can deploy this to:

VPS (Linux server)
Docker
Cloud (AWS, etc.)
Local Test
```
curl -X POST http://localhost:8000/generate-podcast \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello, this is Classio.", "voice": "aria"}' \
  --output test.mp3
```

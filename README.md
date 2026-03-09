# Classio TTS Server

Neural TTS backend for Classio using Piper TTS. Deploy to Render.com.

## Voices included

| ID    | Name  | Gender | Description        |
|-------|-------|--------|--------------------|
| aria  | Aria  | Female | Warm & natural     |
| nova  | Nova  | Female | Bright & clear     |
| jade  | Jade  | Female | Calm & smooth      |
| echo  | Echo  | Male   | Deep & confident   |
| atlas | Atlas | Male   | Bold & clear       |
| fable | Fable | Male   | Friendly & warm    |

---

## Deploy to Render (step by step)

### Step 1 — Push this folder to a new GitHub repo

1. Create a new GitHub repo called `classio-tts-server`
2. Push this folder to it:
```bash
cd classio-tts-server
git init
git add .
git commit -m "Initial TTS server"
git remote add origin https://github.com/YOUR_USERNAME/classio-tts-server.git
git push -u origin main
```

### Step 2 — Create a Web Service on Render

1. Go to https://render.com → **New** → **Web Service**
2. Connect your `classio-tts-server` GitHub repo
3. Fill in these settings:

| Setting        | Value                                           |
|----------------|-------------------------------------------------|
| Name           | `classio-tts`                                   |
| Runtime        | `Python 3`                                      |
| Build Command  | `bash build.sh`                                 |
| Start Command  | `uvicorn server:app --host 0.0.0.0 --port $PORT`|
| Instance Type  | `Free`                                          |

4. Click **Create Web Service**
5. Wait for the build to finish (~3-5 minutes first time)
6. Your server URL will be: `https://classio-tts.onrender.com`

### Step 3 — Add a Persistent Disk (so voice models survive restarts)

1. In your Render service → **Disks** → **Add Disk**
2. Settings:
   - Name: `piper-models`
   - Mount Path: `/tmp/piper-models`
   - Size: `2 GB`
3. Click **Save**

> ⚠️ Without this, voice models re-download on every restart (~30s extra)

### Step 4 — Connect to Classio frontend

Add this to your Classio `public/index.html`, **before** the `<script>` tag that loads your React app:

```html
<script>
  window.__CLASSIO_TTS_URL__ = "https://classio-tts.onrender.com";
</script>
```

Replace the URL with your actual Render URL.

---

## API

### POST /generate-podcast

Generates audio from text.

**Request:**
```json
{
  "text": "Your podcast script here...",
  "voice": "aria",
  "speed": 1.0,
  "format": "mp3"
}
```

**Response:** Audio file (audio/mpeg or audio/wav)

### GET /voices

Returns all available voices.

### GET /health

Health check — returns `{"status": "healthy"}`

---

## Important notes

- **Free tier cold starts**: Render free tier spins down after 15 min idle. First request after idle takes ~30 seconds to wake up. Show a loading spinner (already built into the player).
- **First voice generation**: Downloads the voice model from HuggingFace (~80MB). Takes ~30s. Subsequent generations are fast (~5-15s).
- **Persistent disk**: Add the 2GB disk so models survive restarts and are not re-downloaded every time.
- **Speed control**: Speed is baked into the audio file at generation time (not adjustable after). Changing speed regenerates the audio.

---

## Local development

```bash
# Install system deps (Ubuntu/Debian)
sudo apt-get install espeak-ng ffmpeg

# Install Python deps
pip install -r requirements.txt

# Run server
uvicorn server:app --reload --port 8000

# Test
curl -X POST http://localhost:8000/generate-podcast \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello, this is a test.", "voice": "aria"}' \
  --output test.mp3
```

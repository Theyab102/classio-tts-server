# Classio TTS server

Piper speech synthesis for Classio. The application is `server:app` in `server.py`.
The historical `App.js` here is not built or served. The active React frontend is
in `Theyab102/Classio`; its AI provider credentials remain server-only.

## Local setup

Use the Python 3.11 version pinned in `.python-version`.

```sh
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
MODELS_DIR=/tmp/piper-models .venv/bin/uvicorn server:app --host 127.0.0.1 --port 8001
```

For a managed cloud checkout with the prepared environment, use
`/workspace/.venvs/classio-tts/bin/uvicorn` instead of the local `.venv` path.
Port 8001 avoids reserved cloud desktop ports. Production hosting can use its
assigned `PORT` with the existing `render.yaml` start command.

Set `REACT_APP_CLASSIO_TTS_URL=http://127.0.0.1:8001` when starting the local
Classio frontend. Do not inject a different window global in `public/index.html`.
Keep the configured HTTPS speech endpoint for the production frontend.

## API

- `GET /health` returns `{"status":"healthy"}`. It does not prove synthesis works.
- `GET /voices` returns six voice IDs and labels.
- `POST /generate-podcast` accepts JSON `text`, `voice` and `speed` (0.5–3.0) and
  returns **WAV**, not MP3. Text is limited to 5,000 characters; the current podcast
  frontend already splits episodes into turns. Older scripts are chunked on restore.

```sh
curl --fail http://127.0.0.1:8001/generate-podcast \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello, this is Classio.","voice":"aria","speed":1}' \
  --output /tmp/classio-speech.wav
```

| ID | Piper model |
| --- | --- |
| aria | en_US-lessac-medium |
| nova | en_US-amy-medium |
| jade | en_GB-jenny_dioco-medium |
| echo | en_US-ryan-medium |
| atlas | en_GB-alan-medium |
| fable | en_US-joe-medium |

Models/configuration download from `rhasspy/piper-voices` on Hugging Face at first
use and are cached in `MODELS_DIR`. Both files must finish downloading before the
cache is published. Retain TLS verification and obtain models from the declared
source. Network policy must permit `huggingface.co` and its actual `hf.co`
download hosts. These destinations were blocked in this cloud instance during
onboarding, so a real model download/WAV check remains outstanding.

## Public-service protections

Set `CLASSIO_ALLOWED_ORIGINS` to comma-separated actual frontend origins. Defaults
include the existing Vercel site and local port 3000. CORS constrains browsers;
it is not authentication. Do not trust a caller-supplied forwarding header as
identity. The service bounds request bodies, text and speed; allows two synthesis
jobs concurrently; and applies per-instance limits of 30 requests per client
per minute and 60 total. This permits a full 12-turn episode and an immediate
voice rebuild without dropping the normal flow. Multi-instance deployments also
need upstream limits.

Personal audio is `no-store`. Error responses omit internal paths/network details,
and diagnostic messages omit the script. The public API deliberately has no paid
provider key. Its limits are not a deployment-wide cost or abuse guarantee.

## Tests

```sh
.venv/bin/python -m unittest -v test_server.py
```

Five tests cover health/catalog, validation/body limits, sanitized errors,
private caching, rate limiting and CORS. Synthesis is mocked in this suite; the
real WAV request above is a separate integration check. No live production
provider or physical-device validation is implied by these tests.

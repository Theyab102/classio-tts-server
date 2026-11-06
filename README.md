# Classio podcast / Piper voice server

The subsequent security pass uses FastAPI 0.140.0, Starlette 1.3.1, Pydantic 2.14.3
and Python 3.11.17. `requirements.lock` and `requirements-dev.lock` include exact
dependency hashes. A fresh locked install, the 18 tests and bundled phonemization
passed on that runtime; `pip-audit` reported no known project dependency
vulnerabilities. This does not establish live voice quality or hosted deployment.

Python 3.11.17, FastAPI, Piper 1.2.0 and FFmpeg. This branch upgrades the existing
service with private one/two-host jobs and measured phrase captions. Maintain the
React application in `Theyab102/Classio`; this repository's root `App.js` is a
legacy snapshot and is not served by FastAPI.

## Install and start

```sh
python3.11 -m venv .venv
. .venv/bin/activate
pip install --require-hashes -r requirements.lock
# Install FFmpeg for compact AAC/M4A output. espeak-ng is useful for diagnostics;
# the pinned piper_phonemize wheel also supplies an eSpeak library.
```

Configure variables securely on your host, using `.env.example` for names. The
application does not automatically load a dotenv file. Never commit a real `.env`.

- `CLASSIO_TTS_SIGNING_SECRET`: the identical random 32+ character **server-only**
  value in this service and Vercel. No frontend prefix. Without it jobs fail closed.
- `PODCAST_DATA_DIR`: private **persistent** directory for SQLite and generated
  audio. Default `/tmp/classio-podcasts` is temporary unless mounted persistently.
- `MODELS_DIR`: model cache; use persistent storage to avoid repeated downloads.
- `CLASSIO_ALLOWED_ORIGINS`: comma-separated production/authorized-preview origins.
  CORS is supplementary; HMAC tickets enforce access.
- `CLASSIO_VOICE_QUALITY=medium`: original resource profile; `high` upgrades Aria
  and Echo to their catalog high-quality models. Test memory and licenses first.
- `PODCAST_CACHE_TTL_SECONDS=86400`: completed/failed server cache retention. Cache
  is pruned on startup/new jobs, not a promise of immediate scheduled deletion.
- `CLASSIO_ALLOW_LEGACY_TTS=false`: keep the old unscoped synthesis route disabled.

```sh
uvicorn server:app --host 0.0.0.0 --port 8000 --workers 1
```

Use **one process and one replica per job directory**. The local executor/SQLite
queue is durable but has no distributed lease for multiple workers/replicas.
Restart recovery resumes queued work; a partly synthesized job restarts its audio
assembly. A reverse proxy should terminate HTTPS. Do not expose the data/model
folders through static hosting. `render.yaml` keeps the existing 2 GiB model disk
and puts podcast data on it; inspect costs and capacity before provisioning it.
No hosting plan, paid resource or deployment was created by this work.

## Connect the main application

Set public `REACT_APP_CLASSIO_PODCAST_URL` to this service's HTTPS origin at build
time. Preserve `REACT_APP_CLASSIO_TTS_URL` for the existing Hugging Face transcript
service if it is separate. This repository does not implement `/youtube-transcript`.
Configure the shared secret on Vercel and this server, plus the main application's
Firebase Admin/quota/provider settings. Redeploy/rebuild after those changes.
Never put the signing secret in either public URL or browser JavaScript.

The app first requests a short-lived ticket from `/api/podcast`, after signed age
access/account checks and quotas. This service verifies the ticket's signature,
expiry, pseudonymous owner and exact normalized script/voice fingerprint for
creation, status and audio. Tokens are sent in Authorization headers, not URLs.
Knowing a job ID alone does not grant audio access.

## HTTP contract

- `GET /health`: process readiness, not proof that every voice model is installed.
- `GET /voices`: the six English voice IDs.
- `GET /podcasts/capabilities`: language/host/alignment/configuration information.
- `POST /podcasts/jobs`: validated JSON and `Authorization: Bearer <ticket>`.
- `GET /podcasts/jobs/{id}`: authorized status/progress/metadata.
- `GET /podcasts/jobs/{id}/audio`: authorized private/no-store M4A or WAV.
- `POST /generate-podcast`: HTTP 410 by default. Temporary legacy opt-in restores
  the old unscoped, single-voice route for migration only; leave it off in production.

Example **non-secret** job payload (obtain a ticket through Classio):

```json
{
  "language": "en",
  "voices": ["aria", "echo"],
  "speed": 1.0,
  "dialogue": [
    {"speaker": 0, "text": "Energy transfers between objects."},
    {"speaker": 1, "text": "What happens when a moving ball hits another ball?"}
  ]
}
```

One/two distinct voices, up to 80 turns, 1,200 characters/turn and 40,000 total.
Synthesis speed is 0.75–1.25 with at most two decimal places. Player playback
speed is separate. Invalid/unknown fields are rejected; both hosts must speak.
The 1 MiB HTTP body cap applies before schema parsing. Jobs are idempotent per
owner+input; a completed request reuses audio. The queue allows two pending jobs
per owner and eight globally; failure responses preserve the client's script.
Public errors/logs omit scripts, keys, provider responses and internal paths.

Metadata includes actual `duration`, voices, sample rate, `captions`, `envelope`
and `envelopeStep`. Each caption has speaker/turn/text/start/end. Alignment is
`synthesized-phrase-boundaries`: every complete phrase is separately synthesized
and its exact PCM length defines the cue. It is not word alignment or lip sync.
The player follows the audio element's current time and generated RMS envelope.

The assembler trims surrounding silence, applies short fades, bounds RMS gain
and peaks, and writes WAV incrementally to limit memory. FFmpeg encodes AAC/M4A
for smaller transfers and Safari playback; a real WAV remains if encoding fails.
Private files use mode 0600. Completed scripts are removed from the SQLite payload;
caption text remains with cached audio until cleanup. Put the directory on a
private volume and include its storage/access/retention in your operator policy.

## Voices, downloads and licenses

| ID | Medium model | High override |
| --- | --- | --- |
| aria | en_US-lessac-medium | en_US-lessac-high |
| nova | en_US-amy-medium | unchanged |
| jade | en_US-kristin-medium | unchanged |
| echo | en_US-ryan-medium | en_US-ryan-high |
| atlas | en_US-joe-medium | unchanged |
| fable | en_US-john-medium | unchanged |

Model, JSON configuration and model-card downloads are checked against the pinned
Piper package's catalog hashes/sizes. Staged pairs are atomically installed only
after verification. The model cache holds at most two loaded voices, with locks.
Do not bypass TLS or checksum verification to make a failed download pass.
All paths were checked against the installed catalog, but real model downloads
and voice quality were blocked by this environment's network policy.

Review each downloaded `MODEL_CARD` (stored with its voice prefix), dataset license
and Piper dependency licenses for your intended distribution/hosting. Alias names
are Classio UI names; they do not imply a guarantee of naturalness, emotional
controls or commercial licensing. High-quality models need additional memory.
Only English audio is supported by this catalog. Listen to real examples from
every enabled voice before release; no claim of Turbo AI-equivalent speech quality
is made from synthetic tests.

## Verification

```sh
PYTHONDONTWRITEBYTECODE=1 python -m unittest -v test_server test_podcasts
```

For local tests, install the hashed development lock first:
`pip install --require-hashes -r requirements-dev.lock`.

18 tests executed successfully in the cloud task: HTTP/contracts, input/ticket
validation, cross-owner and changed-script denial, queue/replay/recovery, failed
segments, clipping limits, real PCM-duration caption boundaries and AAC encoding.
Model downloads/speech synthesis are test doubles where required. These tests do
not establish live Piper pronunciation or natural voice quality.

For local cross-repository Chromium QA only:

```sh
python tests/fixture_server.py
```

This loopback-only fixture produces explicit sine-wave speech stand-ins, using
the real job store, authorization, PCM assembly and FFmpeg pipeline. It refuses
common production hosts. **Never deploy this test entry point.** In Classio run
`npm run build`, `node tests/production-preview.cjs`, then `npm run test:integrated`.
The browser verifies actual audio playback/pause/seek/speed/captions/replay using
those stand-ins. Live speech and physical iPhone/iPad checks remain necessary.

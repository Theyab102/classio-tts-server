#!/usr/bin/env bash
set -euo pipefail

echo "=== Installing Python dependencies ==="
python -m pip install --require-hashes -r requirements.lock

echo "=== Build complete ==="

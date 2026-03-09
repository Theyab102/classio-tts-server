#!/usr/bin/env bash
# Render build script — runs before the server starts
set -e

echo "=== Installing system dependencies ==="
apt-get update -qq
apt-get install -y -qq espeak-ng libespeak-ng-dev ffmpeg

echo "=== Installing Python dependencies ==="
pip install --upgrade pip
pip install -r requirements.txt

echo "=== Build complete ==="

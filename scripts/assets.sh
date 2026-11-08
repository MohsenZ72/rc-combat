#!/usr/bin/env bash
# Fetch the CC0 assets (see scripts/fetch-assets.py) in a private virtualenv,
# so it works with any python3 (Homebrew's refuses global pip installs).
set -euo pipefail
cd "$(dirname "$0")/.."
VENV=.cache/assets-venv
PY="${PYTHON:-python3}"
command -v cwebp >/dev/null || { echo "cwebp not found: brew install webp" >&2; exit 1; }
[ -x node_modules/.bin/gltf-transform ] || { echo "gltf-transform not found: run npm install" >&2; exit 1; }
if [ ! -x "$VENV/bin/python" ]; then
  echo "creating $VENV with $("$PY" --version)"
  "$PY" -m venv "$VENV"
fi
"$VENV/bin/python" -m pip install --quiet --disable-pip-version-check -r scripts/requirements-assets.txt
exec "$VENV/bin/python" scripts/fetch-assets.py "$@"

#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "[Spectra] Running idempotent database schema & benchmark seed..."
  python -m backend.db.init_db || echo "[Spectra] Warning: DB init skipped or failed; continuing with fallback."
fi

PORT_TO_BIND="${PORT:-7860}"
echo "[Spectra] Launching Unified FastAPI Mission Engine on 0.0.0.0:${PORT_TO_BIND}"
exec uvicorn backend.main:app \
  --host 0.0.0.0 \
  --port "${PORT_TO_BIND}" \
  --workers 1 \
  --timeout-keep-alive 30

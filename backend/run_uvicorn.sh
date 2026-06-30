#!/usr/bin/env bash
# Simple helper to run uvicorn with an optional BACKEND_PORT environment variable
set -euo pipefail

PORT=${BACKEND_PORT:-8000}
RELOAD=${UVICORN_RELOAD:-1}

if [ -f ".venv/bin/activate" ]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi

PYTHON_BIN="${PYTHON:-python3}"

TLS_PATHS="$("${PYTHON_BIN}" - <<'PY'
from config import settings
from services.tls import prepare_tls_paths

paths = prepare_tls_paths(
    data_dir=settings.data_dir,
    configured_cert=settings.tls_cert,
    configured_key=settings.tls_key,
)
print(f"{paths.cert}\n{paths.key}")
PY
)"
TLS_CERT="$(printf '%s\n' "${TLS_PATHS}" | sed -n '1p')"
TLS_KEY="$(printf '%s\n' "${TLS_PATHS}" | sed -n '2p')"

echo "Starting uvicorn with HTTPS on port ${PORT}"
if [[ "${RELOAD}" == "0" || "${RELOAD}" == "false" || "${RELOAD}" == "False" ]]; then
  uvicorn main:app --host 0.0.0.0 --port "${PORT}" \
    --ssl-certfile "${TLS_CERT}" \
    --ssl-keyfile "${TLS_KEY}"
else
  uvicorn main:app --host 0.0.0.0 --port "${PORT}" --reload \
    --ssl-certfile "${TLS_CERT}" \
    --ssl-keyfile "${TLS_KEY}"
fi

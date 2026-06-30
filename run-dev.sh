#!/usr/bin/env bash
# Start frontend and backend dev servers and stop them cleanly on exit.
set -euo pipefail

usage() {
  cat <<-EOF
Usage: $0 [--frontend-host HOST] [--frontend-port PORT] [--backend-port PORT]

Starts frontend and backend in development mode.

Options:
      --frontend-host HOST   Host for frontend dev server (default: 0.0.0.0)
  -f, --frontend-port PORT   Port for frontend dev server (default: 3000)
  -b, --backend-port PORT    Port for backend uvicorn server (default: 8000)
  -h, --help                 Show this help

Examples:
  # start frontend on 3000 and backend on 8000
  $0

  # custom ports
  $0 --frontend-port 4000 --backend-port 9000

  # bind frontend to localhost only
  $0 --frontend-host 127.0.0.1

When the frontend binds to 0.0.0.0, open https://localhost:PORT on this machine
or use this machine's hostname/LAN IP from another device. The frontend dev
server uses HTTPS for credential entry.

Logs are written to ./logs/frontend.log and ./logs/backend.log
EOF
}

FRONTEND_PORT=3000
FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
BACKEND_PORT=8000
FRONT_PID=""
BACK_PID=""
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

cleanup() {
  echo "Stopping services..."
  # kill process groups if possible
  if [[ -n "${FRONT_PID:-}" ]]; then
    echo "Killing frontend group (PID ${FRONT_PID})"
    kill -TERM -"${FRONT_PID}" 2>/dev/null || kill -TERM "${FRONT_PID}" 2>/dev/null || true
  fi
  if [[ -n "${BACK_PID:-}" ]]; then
    echo "Killing backend group (PID ${BACK_PID})"
    kill -TERM -"${BACK_PID}" 2>/dev/null || kill -TERM "${BACK_PID}" 2>/dev/null || true
  fi
  # wait for processes to exit
  wait 2>/dev/null || true
  echo "Stopped."
}

trap 'cleanup; exit' INT TERM EXIT

while [[ ${#} -gt 0 ]]; do
  case "$1" in
    --frontend-host)
      FRONTEND_HOST=${2:-}
      shift 2
      ;;
    -f|--frontend-port)
      FRONTEND_PORT=${2:-}
      shift 2
      ;;
    -b|--backend-port)
      BACKEND_PORT=${2:-}
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"

frontend_access_url() {
  local host="$1"
  local port="$2"

  if [[ "$host" == "0.0.0.0" || "$host" == "::" ]]; then
    host="localhost"
  elif [[ "$host" == *:* && "$host" != \[*\] ]]; then
    host="[${host}]"
  fi

  printf 'https://%s:%s' "$host" "$port"
}

frontend_hostname_url() {
  local bind_host="$1"
  local port="$2"
  local host

  if [[ "$bind_host" != "0.0.0.0" && "$bind_host" != "::" ]]; then
    return 0
  fi

  host="$(hostname 2>/dev/null || true)"
  if [[ -z "$host" || "$host" == "localhost" || "$host" == "0.0.0.0" || "$host" == "::" ]]; then
    return 0
  fi

  frontend_access_url "$host" "$port"
}

resolve_tls_paths() {
  local python_bin="${PYTHON:-python3}"

  (
    cd "${SCRIPT_DIR}/backend"
    if [ -f ".venv/bin/activate" ]; then
      # shellcheck disable=SC1091
      . .venv/bin/activate
    fi
    AGENTFARM_DATA_DIR="${BACKEND_DATA_DIR}" "${python_bin}" - <<'PY'
from config import settings
from services.tls import prepare_tls_paths

paths = prepare_tls_paths(
    data_dir=settings.data_dir,
    configured_cert=settings.tls_cert,
    configured_key=settings.tls_key,
)
print(paths.cert.resolve())
print(paths.key.resolve())
PY
  )
}

FRONTEND_BACKEND_URL="${BACKEND_URL:-https://127.0.0.1:${BACKEND_PORT}}"
if [[ -n "${AGENTFARM_DATA_DIR:-}" ]]; then
  if [[ "${AGENTFARM_DATA_DIR}" = /* ]]; then
    BACKEND_DATA_DIR="${AGENTFARM_DATA_DIR}"
  else
    BACKEND_DATA_DIR="${SCRIPT_DIR}/${AGENTFARM_DATA_DIR}"
  fi
else
  BACKEND_DATA_DIR="${SCRIPT_DIR}/data"
fi
FRONTEND_URL="$(frontend_access_url "${FRONTEND_HOST}" "${FRONTEND_PORT}")"
FRONTEND_HOSTNAME_URL="$(frontend_hostname_url "${FRONTEND_HOST}" "${FRONTEND_PORT}")"
TLS_PATHS="$(resolve_tls_paths)"
FRONTEND_TLS_CERT="$(printf '%s\n' "${TLS_PATHS}" | sed -n '1p')"
FRONTEND_TLS_KEY="$(printf '%s\n' "${TLS_PATHS}" | sed -n '2p')"

echo "Running frontend format and lint check on changed files..."

# Get list of changed files in frontend directory that match supported extensions
CHANGED_FILES=$(git diff --name-only --diff-filter=d HEAD | grep "^frontend/.*\.\(ts\|tsx\|js\|jsx\|json\|css\)$" || true)
# ESLint only runs on JS/TS files (not JSON/CSS)
ESLINT_FILES=$(git diff --name-only --diff-filter=d HEAD | grep "^frontend/.*\.\(ts\|tsx\|js\|jsx\)$" || true)

if [ -n "$CHANGED_FILES" ]; then
    # Strip 'frontend/' prefix for running commands inside the directory
    RELATIVE_FILES=$(echo "$CHANGED_FILES" | sed 's/^frontend\///')
    RELATIVE_ESLINT_FILES=$(echo "$ESLINT_FILES" | sed 's/^frontend\///' || true)

    # Run prettier on all files, eslint only on JS/TS files
    LINT_FAILED=0
    if ! (cd frontend && echo "$RELATIVE_FILES" | xargs pnpm prettier --write > /dev/null 2>&1); then
        LINT_FAILED=1
    fi
    if [ -n "$RELATIVE_ESLINT_FILES" ]; then
        if ! (cd frontend && echo "$RELATIVE_ESLINT_FILES" | xargs pnpm eslint > /dev/null 2>&1); then
            LINT_FAILED=1
        fi
    fi

    if [ "$LINT_FAILED" -eq 1 ]; then
        echo "Format or lint check failed on changed files. Running again with output:"
        (cd frontend && echo "$RELATIVE_FILES" | xargs pnpm prettier --write)
        if [ -n "$RELATIVE_ESLINT_FILES" ]; then
            (cd frontend && echo "$RELATIVE_ESLINT_FILES" | xargs pnpm eslint)
        fi
        exit 1
    fi
    echo "Frontend checks passed on $(echo "$CHANGED_FILES" | wc -l) file(s)."
else
    echo "No changed frontend files to check."
fi

# Frontend tests (only when relevant files changed)
if [ -n "$CHANGED_FILES" ]; then
  echo "Running frontend unit tests on changed tree..."
  if ! (cd frontend && pnpm test > /dev/null 2>&1); then
    echo "Frontend unit tests failed. Running again with output:"
    (cd frontend && pnpm test)
    exit 1
  fi
  echo "Frontend unit tests passed."
else
  echo "No frontend changes requiring unit tests."
fi

# Backend linting with ruff (if installed)
echo "Running backend lint check..."
BACKEND_CHANGED=$(git diff --name-only --diff-filter=d HEAD | grep "^backend/.*\.py$" || true)

if [ -n "$BACKEND_CHANGED" ]; then
    if command -v ruff &> /dev/null || [ -x "backend/.venv/bin/ruff" ]; then
        RUFF_CMD="ruff"
        if [ -x "backend/.venv/bin/ruff" ]; then
            RUFF_CMD="backend/.venv/bin/ruff"
        fi

        if ! $RUFF_CMD check backend/ > /dev/null 2>&1; then
            echo "Backend lint check failed:"
            $RUFF_CMD check backend/
            exit 1
        fi
        echo "Backend checks passed on $(echo "$BACKEND_CHANGED" | wc -l) file(s)."
    else
        echo "Skipping backend lint (ruff not installed - run: pip install -r backend/requirements-dev.txt)"
    fi
else
    echo "No changed backend files to check."
fi

# Backend tests (only when Python files changed)
if [ -n "$BACKEND_CHANGED" ]; then
  echo "Running backend unit tests..."
  if ! (cd backend && { if [ -f .venv/bin/activate ]; then \
      # shellcheck disable=SC1091
      . .venv/bin/activate; \
    fi; command -v pytest > /dev/null 2>&1; }); then
    echo "pytest is not available. Install backend dev dependencies (pip install -r backend/requirements-dev.txt)."
    exit 1
  fi
  if ! (cd backend && { if [ -f .venv/bin/activate ]; then \
      # shellcheck disable=SC1091
      . .venv/bin/activate; \
    fi; pytest > /dev/null 2>&1; }); then
    echo "Backend unit tests failed. Running again with output:"
    (cd backend && { if [ -f .venv/bin/activate ]; then \
      # shellcheck disable=SC1091
      . .venv/bin/activate; \
    fi; pytest; })
    exit 1
  fi
  echo "Backend unit tests passed."
else
  echo "No backend changes requiring unit tests."
fi

mkdir -p logs

echo "Starting backend on port ${BACKEND_PORT} (logs: logs/backend.log)"
echo "Backend data dir: ${BACKEND_DATA_DIR}"
# Use setsid so the command runs in its own session/process-group; we'll kill the group on exit.
setsid env AGENTFARM_DATA_DIR="${BACKEND_DATA_DIR}" BACKEND_PORT="${BACKEND_PORT}" bash -lc "cd backend && ./run_uvicorn.sh" > logs/backend.log 2>&1 &
BACK_PID=$!

echo "Starting frontend on ${FRONTEND_HOST}:${FRONTEND_PORT} (logs: logs/frontend.log)"
echo "Frontend bind host: ${FRONTEND_HOST}"
echo "Frontend URL: ${FRONTEND_URL}"
if [[ -n "${FRONTEND_HOSTNAME_URL}" ]]; then
  echo "Frontend hostname URL: ${FRONTEND_HOSTNAME_URL}"
fi
if [[ "${FRONTEND_HOST}" == "0.0.0.0" || "${FRONTEND_HOST}" == "::" ]]; then
  echo "0.0.0.0 is the bind address, not a browser URL."
  echo "For access from another device, use this machine's hostname or LAN IP with port ${FRONTEND_PORT}."
fi
echo "Frontend TLS certificate: ${FRONTEND_TLS_CERT}"
setsid env FRONTEND_HOST="${FRONTEND_HOST}" FRONTEND_PORT="${FRONTEND_PORT}" FRONTEND_TLS_CERT="${FRONTEND_TLS_CERT}" FRONTEND_TLS_KEY="${FRONTEND_TLS_KEY}" BACKEND_PORT="${BACKEND_PORT}" BACKEND_URL="${FRONTEND_BACKEND_URL}" bash -lc "cd frontend && pnpm dev" > logs/frontend.log 2>&1 &
FRONT_PID=$!

echo "Frontend PID: ${FRONT_PID}, Backend PID: ${BACK_PID}"

# Wait for services to be ready
if command -v curl >/dev/null; then
    wait_for_url() {
        local url="$1"
        local name="$2"
        local pid="${3:-}"
        local curl_tls_flag="${4:-}"
        local curl_args=()
        local max_attempts=60
        local attempt=1

        if [[ -n "$curl_tls_flag" ]]; then
            curl_args+=("$curl_tls_flag")
        fi

        echo -n "Waiting for $name to be ready at $url..."
        while [ $attempt -le $max_attempts ]; do
            if [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; then
                echo " Failed! $name process exited early (PID $pid)."
                return 1
            fi
            if curl "${curl_args[@]}" -s -o /dev/null -w "%{http_code}" "$url" | grep -q "200"; then
                echo " Ready!"
                return 0
            fi
            echo -n "."
            sleep 1
            attempt=$((attempt + 1))
        done
        echo " Timeout!"
        return 1
    }

    wait_for_url "https://localhost:${BACKEND_PORT}/api/v1/health" "Backend" "${BACK_PID}" "-k"
    wait_for_url "https://localhost:${FRONTEND_PORT}/api/health" "Frontend" "${FRONT_PID}" "-k"
    # Warm up a public frontend page so unauthenticated auth redirects do not fail startup.
    wait_for_url "https://localhost:${FRONTEND_PORT}/login" "Frontend (Warmup)" "${FRONT_PID}" "-k"
else
    echo "curl not found, skipping health checks."
fi

echo "Tail logs with: tail -F logs/frontend.log logs/backend.log"

# Wait until signals are received; sleep in a loop so trap can fire.
while true; do
  sleep 1
done

#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
scratch_parent="${repo_root}/.tmp/agent"
mkdir -p "${scratch_parent}"
scratch_dir="$(mktemp -d "${scratch_parent}/run-dev.XXXXXX")"

cleanup() {
  rm -rf "${scratch_dir}"
}
trap cleanup EXIT

stub_bin="${scratch_dir}/bin"
mkdir -p "${stub_bin}"
setsid_log="${scratch_dir}/setsid.log"
run_log="${scratch_dir}/run-dev.log"
make_run_log="${scratch_dir}/make-run.log"
next_log="${scratch_dir}/next.log"
curl_log="${scratch_dir}/curl.log"
tls_cert="${scratch_dir}/configured.crt"
tls_key="${scratch_dir}/configured.key"
real_git="$(command -v git)"
export RUN_DEV_SETSID_LOG="${setsid_log}"
export RUN_DEV_NEXT_LOG="${next_log}"
export RUN_DEV_CURL_LOG="${curl_log}"
export RUN_DEV_REAL_GIT="${real_git}"
: > "${setsid_log}"
: > "${next_log}"
: > "${curl_log}"
printf 'configured cert\n' > "${tls_cert}"
printf 'configured key\n' > "${tls_key}"

make_env_host="203.0.113.17"
printf 'FRONTEND_HOST=%s\n' "${make_env_host}" > "${scratch_dir}/.env"
(
  cd "${scratch_dir}"
  make -n -f "${repo_root}/Makefile" run > "${make_run_log}"
)

if ! grep -F -- "--frontend-host \"${make_env_host}\"" "${make_run_log}" >/dev/null; then
  cat "${make_run_log}"
  echo "make run did not load .env and forward the configured frontend host" >&2
  exit 1
fi

cat > "${stub_bin}/git" <<'STUB'
#!/usr/bin/env bash
if [[ "${1:-}" == "diff" ]]; then
  exit 0
fi
exec "${RUN_DEV_REAL_GIT}" "$@"
STUB
chmod +x "${stub_bin}/git"

cat > "${stub_bin}/curl" <<'STUB'
#!/usr/bin/env bash
printf '%q ' "$@" >> "${RUN_DEV_CURL_LOG}"
printf '\n' >> "${RUN_DEV_CURL_LOG}"
printf '200'
STUB
chmod +x "${stub_bin}/curl"

cat > "${stub_bin}/setsid" <<'STUB'
#!/usr/bin/env bash
printf '%q ' "$@" >> "${RUN_DEV_SETSID_LOG}"
printf '\n' >> "${RUN_DEV_SETSID_LOG}"
exec bash -c 'trap "exit 0" TERM INT; while true; do sleep 1; done'
STUB
chmod +x "${stub_bin}/setsid"

cat > "${stub_bin}/hostname" <<'STUB'
#!/usr/bin/env bash
printf 'devhost.local\n'
STUB
chmod +x "${stub_bin}/hostname"

cat > "${stub_bin}/next" <<'STUB'
#!/usr/bin/env bash
printf '%q ' "$@" >> "${RUN_DEV_NEXT_LOG}"
printf '\n' >> "${RUN_DEV_NEXT_LOG}"
STUB
chmod +x "${stub_bin}/next"

frontend_dev_script="$(node -e 'process.stdout.write(require("./frontend/package.json").scripts.dev)')"
FRONTEND_HOST=127.0.0.1 FRONTEND_PORT=3999 FRONTEND_TLS_CERT="${tls_cert}" FRONTEND_TLS_KEY="${tls_key}" PATH="${stub_bin}:${PATH}" bash -c "${frontend_dev_script}"

if ! grep -F -- "--experimental-https" "${next_log}" >/dev/null; then
  cat "${next_log}"
  echo "frontend dev script did not enable HTTPS for next" >&2
  exit 1
fi

if ! grep -F -- "--experimental-https-key ${tls_key}" "${next_log}" >/dev/null; then
  cat "${next_log}"
  echo "frontend dev script did not pass the HTTPS key to next" >&2
  exit 1
fi

if ! grep -F -- "--experimental-https-cert ${tls_cert}" "${next_log}" >/dev/null; then
  cat "${next_log}"
  echo "frontend dev script did not pass the HTTPS certificate to next" >&2
  exit 1
fi

if ! grep -F -- "-H 127.0.0.1" "${next_log}" >/dev/null; then
  cat "${next_log}"
  echo "frontend dev script did not pass FRONTEND_HOST to next" >&2
  exit 1
fi

if ! grep -F -- "-p 3999" "${next_log}" >/dev/null; then
  cat "${next_log}"
  echo "frontend dev script did not pass FRONTEND_PORT to next" >&2
  exit 1
fi

set +e
(
  cd "${repo_root}"
  FRONTEND_HOST=0.0.0.0 AGENTFARM_TLS_CERT="${tls_cert}" AGENTFARM_TLS_KEY="${tls_key}" PATH="${stub_bin}:${PATH}" timeout 8s bash ./run-dev.sh --backend-port 9443 --frontend-port 3999 > "${run_log}" 2>&1
)
status=$?
set -e

if [[ "${status}" -ne 0 && "${status}" -ne 124 && "${status}" -ne 143 ]]; then
  cat "${run_log}"
  echo "run-dev.sh exited unexpectedly with status ${status}" >&2
  exit 1
fi

expected_data_dir="${repo_root}/data"
if ! grep -F "AGENTFARM_DATA_DIR=${expected_data_dir}" "${setsid_log}" >/dev/null; then
  cat "${setsid_log}"
  echo "backend was not started with repo-root AGENTFARM_DATA_DIR" >&2
  exit 1
fi

if ! grep -F "BACKEND_URL=https://127.0.0.1:9443" "${setsid_log}" >/dev/null; then
  cat "${setsid_log}"
  echo "frontend was not started with the HTTPS backend URL" >&2
  exit 1
fi

if ! grep -F "FRONTEND_HOST=0.0.0.0" "${setsid_log}" >/dev/null; then
  cat "${setsid_log}"
  echo "frontend was not started with the configured FRONTEND_HOST" >&2
  exit 1
fi

if ! grep -F "FRONTEND_TLS_CERT=${tls_cert}" "${setsid_log}" >/dev/null; then
  cat "${setsid_log}"
  echo "frontend was not started with the configured TLS certificate" >&2
  exit 1
fi

if ! grep -F "FRONTEND_TLS_KEY=${tls_key}" "${setsid_log}" >/dev/null; then
  cat "${setsid_log}"
  echo "frontend was not started with the configured TLS key" >&2
  exit 1
fi

if ! grep -F "Frontend bind host: 0.0.0.0" "${run_log}" >/dev/null; then
  cat "${run_log}"
  echo "run-dev.sh did not report the frontend bind host" >&2
  exit 1
fi

if ! grep -F "Frontend URL: https://localhost:3999" "${run_log}" >/dev/null; then
  cat "${run_log}"
  echo "run-dev.sh did not report a secure localhost frontend URL" >&2
  exit 1
fi

if ! grep -F "Frontend hostname URL: https://devhost.local:3999" "${run_log}" >/dev/null; then
  cat "${run_log}"
  echo "run-dev.sh did not report a secure hostname frontend URL" >&2
  exit 1
fi

if ! grep -F "Waiting for Frontend to be ready at https://localhost:3999/api/health" "${run_log}" >/dev/null; then
  cat "${run_log}"
  echo "run-dev.sh did not health check the frontend through localhost over HTTPS" >&2
  exit 1
fi

if ! grep -F "https://localhost:3999/api/health" "${curl_log}" | grep -F -- "-k" >/dev/null; then
  cat "${curl_log}"
  echo "run-dev.sh did not allow the self-signed frontend cert during health checks" >&2
  exit 1
fi

git -C "${repo_root}" check-ignore --quiet data/.runtime-probe
git -C "${repo_root}" check-ignore --quiet backend/data/.runtime-probe

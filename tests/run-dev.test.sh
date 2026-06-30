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
real_git="$(command -v git)"
export RUN_DEV_SETSID_LOG="${setsid_log}"
export RUN_DEV_REAL_GIT="${real_git}"
: > "${setsid_log}"

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

set +e
(
  cd "${repo_root}"
  PATH="${stub_bin}:${PATH}" timeout 8s bash ./run-dev.sh --backend-port 9443 --frontend-port 3999 > "${run_log}" 2>&1
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

git -C "${repo_root}" check-ignore --quiet data/.runtime-probe
git -C "${repo_root}" check-ignore --quiet backend/data/.runtime-probe

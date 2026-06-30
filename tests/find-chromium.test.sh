#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
scratch_parent="${repo_root}/.tmp/agent"
mkdir -p "${scratch_parent}"
scratch_dir="$(mktemp -d "${scratch_parent}/find-chromium.XXXXXX")"

cleanup() {
  rm -rf "${scratch_dir}"
}
trap cleanup EXIT

fake_chrome="${scratch_dir}/chrome-from-env"
touch "${fake_chrome}"
chmod +x "${fake_chrome}"

detected="$(
  AGENTFARM_PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="${fake_chrome}" \
    bash "${repo_root}/scripts/find-chromium.sh"
)"
if [[ "${detected}" != "${fake_chrome}" ]]; then
  echo "expected env var browser path, got ${detected}" >&2
  exit 1
fi

path_bin="${scratch_dir}/bin"
mkdir -p "${path_bin}"
fake_path_chrome="${path_bin}/chromium"
touch "${fake_path_chrome}"
chmod +x "${fake_path_chrome}"

detected="$(
  env -u AGENTFARM_PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH \
    -u PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH \
    -u CHROME_PATH \
    -u CHROME_BIN \
    -u CHROMIUM_PATH \
    -u CHROMIUM_BIN \
    -u GOOGLE_CHROME_BIN \
    -u PUPPETEER_EXECUTABLE_PATH \
    PATH="${path_bin}:${PATH}" \
    bash "${repo_root}/scripts/find-chromium.sh"
)"
if [[ "${detected}" != "${fake_path_chrome}" ]]; then
  echo "expected PATH browser path, got ${detected}" >&2
  exit 1
fi

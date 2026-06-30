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

detect_without_explicit_env() {
  env -u AGENTFARM_PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH \
    -u PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH \
    -u CHROME_PATH \
    -u CHROME_BIN \
    -u CHROMIUM_PATH \
    -u CHROMIUM_BIN \
    -u GOOGLE_CHROME_BIN \
    -u PUPPETEER_EXECUTABLE_PATH \
    "$@" \
    bash "${repo_root}/scripts/find-chromium.sh"
}

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

playwright_cache="${scratch_dir}/playwright-cache"
fake_mac_chromium="${playwright_cache}/chromium-123/chrome-mac/Chromium.app/Contents/MacOS/Chromium"
mkdir -p "$(dirname -- "${fake_mac_chromium}")"
touch "${fake_mac_chromium}"
chmod +x "${fake_mac_chromium}"
older_chromium="${playwright_cache}/chromium-99/chrome-mac/Chromium.app/Contents/MacOS/Chromium"
mkdir -p "$(dirname -- "${older_chromium}")"
touch "${older_chromium}"
chmod +x "${older_chromium}"

detected="$(
  detect_without_explicit_env \
    PLAYWRIGHT_BROWSERS_PATH="${playwright_cache}" \
    PATH="${path_bin}:${PATH}" \
)"
if [[ "${detected}" != "${fake_mac_chromium}" ]]; then
  echo "expected Playwright cache browser path, got ${detected}" >&2
  exit 1
fi

fallback_bin="${scratch_dir}/fallback-bin"
mkdir -p "${fallback_bin}"
fake_sort="${fallback_bin}/sort"
real_sort="$(command -v sort)"
{
  printf '%s\n' '#!/usr/bin/env bash'
  printf '%s\n' 'set -euo pipefail'
  printf '%s\n' 'for arg in "$@"; do'
  printf '%s\n' '  case "${arg}" in'
  printf '%s\n' '    -*V*) exit 2 ;;'
  printf '%s\n' '  esac'
  printf '%s\n' 'done'
  printf 'exec %q "$@"\n' "${real_sort}"
} > "${fake_sort}"
chmod +x "${fake_sort}"

detected="$(
  detect_without_explicit_env \
    PLAYWRIGHT_BROWSERS_PATH="${playwright_cache}" \
    PATH="${fallback_bin}:${path_bin}:${PATH}"
)"
if [[ "${detected}" != "${fake_mac_chromium}" ]]; then
  echo "expected Playwright cache browser path without sort -V, got ${detected}" >&2
  exit 1
fi

detected="$(
  detect_without_explicit_env \
    -u PLAYWRIGHT_BROWSERS_PATH \
    PATH="${path_bin}:${PATH}" \
)"
if [[ "${detected}" != "${fake_path_chrome}" ]]; then
  echo "expected PATH browser path, got ${detected}" >&2
  exit 1
fi

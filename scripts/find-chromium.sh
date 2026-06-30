#!/usr/bin/env bash
set -euo pipefail

is_executable_file() {
  [[ -n "${1:-}" && -f "$1" && -x "$1" ]]
}

sort_playwright_cache_candidates() {
  if sort -V </dev/null >/dev/null 2>&1; then
    sort -V -r
    return
  fi

  awk '
    {
      revision = 0
      rest = $0
      while (match(rest, /(chromium|chromium_headless_shell)-[0-9]+/)) {
        segment = substr(rest, RSTART, RLENGTH)
        sub(/^.*-/, "", segment)
        revision = segment + 0
        rest = substr(rest, RSTART + RLENGTH)
      }
      printf "%012d\t%s\n", revision, $0
    }
  ' | sort -r | cut -f2-
}

for env_var in \
  AGENTFARM_PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH \
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH \
  CHROME_PATH \
  CHROME_BIN \
  CHROMIUM_PATH \
  CHROMIUM_BIN \
  GOOGLE_CHROME_BIN \
  PUPPETEER_EXECUTABLE_PATH
do
  candidate="${!env_var:-}"
  if is_executable_file "${candidate}"; then
    printf '%s\n' "${candidate}"
    exit 0
  fi
done

if [[ -n "${PLAYWRIGHT_BROWSERS_PATH:-}" && -d "${PLAYWRIGHT_BROWSERS_PATH}" ]]; then
  while IFS= read -r candidate; do
    if is_executable_file "${candidate}"; then
      printf '%s\n' "${candidate}"
      exit 0
    fi
  done < <(
    find "${PLAYWRIGHT_BROWSERS_PATH}" -type f \
      \( -path '*/chrome-linux*/chrome' -o \
         -path '*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium' -o \
         -path '*/chrome-win*/chrome.exe' -o \
         -path '*/chrome-headless-shell*/chrome-headless-shell' -o \
         -path '*/chrome-headless-shell*/chrome-headless-shell.exe' -o \
         -path '*/chrome-headless-shell-mac*/Chromium.app/Contents/MacOS/Chromium' -o \
         -path '*/chrome-headless-shell*/headless_shell' \) \
      2>/dev/null | sort_playwright_cache_candidates
  )
fi

IFS=':' read -r -a path_entries <<< "${PATH:-}"
for directory in "${path_entries[@]}"; do
  [[ -n "${directory}" ]] || continue
  for binary in chromium chromium-browser google-chrome google-chrome-stable chrome; do
    candidate="${directory}/${binary}"
    if is_executable_file "${candidate}"; then
      printf '%s\n' "${candidate}"
      exit 0
    fi
  done
done

for candidate in \
  /usr/bin/google-chrome-stable \
  /usr/bin/google-chrome \
  /usr/bin/chromium \
  /usr/bin/chromium-browser \
  /snap/bin/chromium \
  /opt/google/chrome/chrome \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  "/c/Program Files/Google/Chrome/Application/chrome.exe" \
  "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe" \
  "/c/Program Files/Microsoft/Edge/Application/msedge.exe" \
  "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
do
  if is_executable_file "${candidate}"; then
    printf '%s\n' "${candidate}"
    exit 0
  fi
done

exit 1

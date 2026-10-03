#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEBUG_PORT="${GNW_DEBUG_PORT:-9223}"
DEBUG_PROFILE="${GNW_DEBUG_PROFILE:-${HOME}/.cache/gnwmanager-chromium-debug}"
APP_URL="${GNW_DEBUG_URL:-http://localhost:3000/?libraryTrace=1}"
START_SERVER=1

usage() {
  cat <<'EOF'
Start or reuse the visible Chromium session used for GNW app debugging.

Usage: scripts/debug-chromium.sh [--no-server] [--url URL]

Environment:
  GNW_DEBUG_CHROMIUM  Chromium executable (otherwise auto-detected)
  GNW_DEBUG_PROFILE   Persistent browser profile
  GNW_DEBUG_PORT      CDP port (default 9223, loopback only)
  GNW_DEBUG_URL       Initial app URL (default http://localhost:3000/?libraryTrace=1)
EOF
}

while (($#)); do
  case "$1" in
    --no-server) START_SERVER=0; shift ;;
    --url) APP_URL="${2:?--url requires a value}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if curl -fsS --max-time 1 "http://127.0.0.1:${DEBUG_PORT}/json/version" >/dev/null 2>&1; then
  echo "Reusing Chromium CDP at http://127.0.0.1:${DEBUG_PORT}; profile: ${DEBUG_PROFILE}"
  echo "The existing window and tabs were left untouched."
  exit 0
fi

if ((START_SERVER)); then
  docker compose -f "${REPO_ROOT}/docker-compose.yml" up -d dev
fi

if ! curl -fsS --max-time 2 http://localhost:3000/ >/dev/null; then
  echo "GNW web app is not responding at http://localhost:3000." >&2
  echo "Start it with 'docker compose up -d dev', or pass --no-server if it is served elsewhere." >&2
  exit 1
fi

CHROMIUM="${GNW_DEBUG_CHROMIUM:-}"
if [[ -z "$CHROMIUM" ]]; then
  for name in chromium chromium-browser google-chrome; do
    if command -v "$name" >/dev/null 2>&1; then CHROMIUM="$(command -v "$name")"; break; fi
  done
fi
if [[ -z "$CHROMIUM" ]]; then
  for candidate in "${HOME}"/.cache/ms-playwright/chromium-*/chrome-linux64/chrome; do
    if [[ -x "$candidate" ]]; then CHROMIUM="$candidate"; fi
  done
fi
if [[ -z "$CHROMIUM" || ! -x "$CHROMIUM" ]]; then
  echo "Could not find Chromium. Set GNW_DEBUG_CHROMIUM to its executable path." >&2
  exit 1
fi

mkdir -p "$DEBUG_PROFILE"
echo "Starting visible Chromium: $CHROMIUM"
echo "Persistent profile: $DEBUG_PROFILE"
nohup "$CHROMIUM" \
  --remote-debugging-address=127.0.0.1 \
  "--remote-debugging-port=${DEBUG_PORT}" \
  "--user-data-dir=${DEBUG_PROFILE}" \
  --no-first-run \
  --no-default-browser-check \
  --new-window "$APP_URL" \
  >/dev/null 2>&1 </dev/null &

for _ in {1..30}; do
  if curl -fsS --max-time 1 "http://127.0.0.1:${DEBUG_PORT}/json/version" >/dev/null 2>&1; then
    echo "Chromium is ready for inspection at http://127.0.0.1:${DEBUG_PORT}."
    exit 0
  fi
  sleep 0.25
done
echo "Chromium was launched but its CDP endpoint did not become ready." >&2
exit 1

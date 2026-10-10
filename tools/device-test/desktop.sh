#!/bin/sh
set -eu
export DISPLAY=:99
desktop_size=${GNW_TEST_DESKTOP_SIZE:-1920x1080}
case "$desktop_size" in
  1920x1080|2560x1440) ;;
  *) echo "Unsupported GNW_TEST_DESKTOP_SIZE: $desktop_size (use 1920x1080 or 2560x1440)" >&2; exit 2 ;;
esac
Xvfb "$DISPLAY" -screen 0 "${desktop_size}x24" -nolisten tcp &
xvfb_pid=$!
trap 'kill "$xvfb_pid" 2>/dev/null || true' EXIT
for attempt in 1 2 3 4 5; do
  xdpyinfo >/dev/null 2>&1 && break
  sleep 1
done
openbox >/tmp/device-test-openbox.log 2>&1 &
if [ "${GNW_TEST_VIEW_DESKTOP:-0}" = 1 ]; then
  x11vnc -display "$DISPLAY" -listen 127.0.0.1 -rfbport 5901 -nopw -forever -shared >/tmp/device-test-vnc.log 2>&1 &
  echo "Virtual desktop available at vnc://127.0.0.1:5901"
  sleep 8
fi
npx playwright test "${GNW_TEST_SPEC:-tests/native-directory-seed.spec.mjs}"

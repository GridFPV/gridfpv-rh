#!/bin/bash
# Xvfb for OBS's window, a session bus so Qt's D-Bus calls answer at once instead of timing
# out, then OBS itself in the foreground (its log goes to stdout, so `docker logs` has it).
set -e
Xvfb :99 -screen 0 1280x720x24 -nolisten tcp >/dev/null 2>&1 &
export DISPLAY=:99
for _ in $(seq 1 50); do xdpyinfo -display :99 >/dev/null 2>&1 && break; sleep 0.2; done
mkdir -p "${XDG_RUNTIME_DIR:-/tmp/runtime-ubuntu}"
exec dbus-run-session -- obs --disable-updater --disable-shutdown-check --collection Test --profile Test "$@"

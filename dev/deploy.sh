#!/usr/bin/env bash
# Deploy the built plugin to a RotorHazard timer over SSH and restart it.
#
#   make deploy TIMER=recon-nh                 # prompts for the timer's sudo password
#   SUDO_PASS=... make deploy TIMER=recon-nh   # or pass it in the environment
#
# Assumes: the zip in dist/ is current (`make zip` first — the Makefile target does this),
# the SSH user can sudo, and RotorHazard runs as a systemd service named `rotorhazard`.
# The data directory (where plugins/ lives) is read from the service's WorkingDirectory
# user's home, or overridden with RH_DATA=/path/to/rh-data.
set -euo pipefail

TIMER="${1:?usage: deploy.sh <ssh host> <zip>}"
ZIP="${2:?usage: deploy.sh <ssh host> <zip>}"
SERVICE="${RH_SERVICE:-rotorhazard}"

if [ -z "${SUDO_PASS:-}" ]; then
  read -r -s -p "sudo password on $TIMER: " SUDO_PASS; echo
fi

echo "→ copying $(basename "$ZIP") to $TIMER"
scp -q "$ZIP" "$TIMER:/tmp/gridfpv-plugin.zip"

echo "→ installing and restarting $SERVICE"
# The password is the first line of the stream (sudo -S reads exactly that), the script
# is the rest (bash -s reads it from the same stdin).
{
  printf '%s\n' "$SUDO_PASS"
  cat <<'REMOTE'
set -euo pipefail
SERVICE="${RH_SERVICE:-rotorhazard}"
RH_USER=$(systemctl show -p User --value "$SERVICE")
RH_HOME=$(getent passwd "$RH_USER" | cut -d: -f6)
DATA="${RH_DATA:-$RH_HOME/rh-data}"
PLUGINS="$DATA/plugins"
[ -d "$DATA" ] || { echo "data dir $DATA not found"; exit 1; }
mkdir -p "$PLUGINS"
STAGE=$(mktemp -d)
unzip -q /tmp/gridfpv-plugin.zip -d "$STAGE"
[ -f "$STAGE/gridfpv/__init__.py" ] || { echo "zip has no gridfpv/__init__.py"; exit 1; }
rm -rf "$PLUGINS/gridfpv"
mv "$STAGE/gridfpv" "$PLUGINS/gridfpv"
chown -R "$RH_USER:$RH_USER" "$PLUGINS/gridfpv"
rm -rf "$STAGE" /tmp/gridfpv-plugin.zip
VERSION=$(python3 -c "import json;print(json.load(open('$PLUGINS/gridfpv/manifest.json'))['version'])")
echo "installed gridfpv $VERSION into $PLUGINS (owner $RH_USER)"
systemctl restart "$SERVICE"
for i in $(seq 1 40); do
  sleep 1
  if curl -sf -o /dev/null http://localhost:5000/; then break; fi
done
systemctl is-active "$SERVICE"
LOG=$(ls -t "$DATA"/logs/*.log 2>/dev/null | head -1)
[ -n "$LOG" ] && grep -E "GridFPV|Loaded external plugin 'gridfpv'|Traceback|gridfpv.*Error" "$LOG" | tail -5
REMOTE
} | ssh "$TIMER" "RH_SERVICE='$SERVICE' RH_DATA='${RH_DATA:-}' sudo -S -k -p '' --preserve-env=RH_SERVICE,RH_DATA bash -s"
echo "→ done"

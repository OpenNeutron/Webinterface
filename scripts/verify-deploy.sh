#!/usr/bin/env sh
# Prove what is actually served, not what was built.
# Usage: scripts/verify-deploy.sh <marker-string> [more markers...]
set -eu
[ $# -ge 1 ] || { echo "usage: $0 <marker> [marker...]"; exit 2; }

LOCAL=$(sha256sum dist/assets/*.js | awk '{print $1}')
SERVED=$(ssh "$DEPLOY_HOST" "sha256sum /opt/on/data/static/assets/*.js | awk '{print \$1}'")

if [ "$LOCAL" != "$SERVED" ]; then
  echo "FAIL served bundle differs from build"
  echo "  local : $LOCAL"
  echo "  served: $SERVED"
  exit 1
fi
echo "ok  served hash $SERVED"

SW=$(ssh "$DEPLOY_HOST" "grep -o 'sloth-mail-shell-v[0-9]*' /opt/on/data/static/sw.js | head -1")
echo "ok  service worker $SW"

# The client is split into chunks (Settings, Compose and the OpenPGP reader load when they
# are opened), so a marker can be in any of them: search them all.
for m in "$@"; do
  if ssh "$DEPLOY_HOST" "grep -lq '$m' /opt/on/data/static/assets/*.js"; then
    echo "ok  marker present: $m"
  else
    echo "FAIL marker missing: $m"
    exit 1
  fi
done

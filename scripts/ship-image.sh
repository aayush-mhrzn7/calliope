#!/usr/bin/env sh
# Build the Calliope image on this computer and load it straight into the server's Docker over
# SSH — no registry, and nothing compiled on the server.
#
#   scripts/ship-image.sh                 # server "homelab", stack in /srv/stacks/calliope
#   scripts/ship-image.sh me@homelab      # any ssh destination
#   STACK_DIR=/opt/calliope scripts/ship-image.sh
#
# Builds for linux/amd64 (an Intel/AMD server) even on an Apple-silicon Mac.
set -eu

HOST="${1:-homelab}"
TAG="${TAG:-calliope:latest}"
PLATFORM="${PLATFORM:-linux/amd64}"
STACK_DIR="${STACK_DIR:-/srv/stacks/calliope}"

cd "$(dirname "$0")/.."

echo "› Building $TAG for $PLATFORM"
docker buildx build --platform "$PLATFORM" -t "$TAG" --load .

echo "› Sending it to $HOST (compressed)"
docker save "$TAG" | gzip | ssh "$HOST" 'gunzip | docker load'

echo "› Restarting Calliope on $HOST"
ssh "$HOST" "if [ -f '$STACK_DIR/compose.yaml' ] || [ -f '$STACK_DIR/docker-compose.yml' ]; then
  cd '$STACK_DIR' && docker compose up -d && docker image prune -f >/dev/null
else
  echo '  (no compose file in $STACK_DIR yet — image loaded, start it yourself)'
fi"
echo "✓ Done"

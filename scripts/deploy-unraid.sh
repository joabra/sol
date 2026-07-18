#!/usr/bin/env bash
# Bygger amd64-imagen och deployar till Unraid via SSH (ingen registry behövs).
# Användning: ./scripts/deploy-unraid.sh [host]
set -euo pipefail
HOST="${1:-root@192.168.1.9}"
IMAGE="ghcr.io/joabra/sol:latest"

cd "$(dirname "$0")/.."

echo "==> Bygger frontend"
(cd web && npm run build)

echo "==> Bygger Docker-image (linux/amd64)"
docker buildx build --platform linux/amd64 -t "$IMAGE" --load .

echo "==> Överför till $HOST"
docker save "$IMAGE" | gzip | ssh "$HOST" 'gunzip | docker load'

echo "==> Startar om containern"
ssh "$HOST" "docker rm -f solvakt >/dev/null 2>&1 || true; \
  docker run -d --name solvakt --restart unless-stopped -p 3000:3000 \
    -v /mnt/user/appdata/solvakt:/data $IMAGE >/dev/null; \
  docker image prune -f >/dev/null; sleep 3; docker logs solvakt 2>&1 | tail -2"

echo "==> Klart! http://$(echo "$HOST" | cut -d@ -f2):3000"

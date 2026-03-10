#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_NAME="pm-mvp:local"
CONTAINER_NAME="pm-mvp-app"
ENV_FILE="$PROJECT_ROOT/.env"

cd "$PROJECT_ROOT"

if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi

docker build -t "$IMAGE_NAME" -f Dockerfile .

if [[ -f "$ENV_FILE" ]]; then
  docker run -d --name "$CONTAINER_NAME" --env-file "$ENV_FILE" -p 8000:8000 "$IMAGE_NAME" >/dev/null
else
  docker run -d --name "$CONTAINER_NAME" -p 8000:8000 "$IMAGE_NAME" >/dev/null
fi

echo "Container '$CONTAINER_NAME' started."
echo "Open http://127.0.0.1:8000"

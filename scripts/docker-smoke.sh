#!/usr/bin/env sh
set -eu

image="${1:?image tag required}"
container="mcp-chrono-smoke-$$"
stdio_container="mcp-chrono-stdio-smoke-$$"
token="$(openssl rand -hex 32)"
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cleanup() { docker rm -f "$container" "$stdio_container" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

docker run --rm -d --name "$container" \
  -e MCP_BEARER_TOKEN="$token" \
  -p 127.0.0.1::3025 \
  "$image" >/dev/null

for _ in $(seq 1 45); do
  port="$(docker port "$container" 3025/tcp | sed 's/.*://')"
  if [ -n "$port" ] && curl --fail --silent \
    -H "Authorization: Bearer $token" \
    "http://127.0.0.1:$port/healthz" | grep -q '"status":"ok"'; then
    break
  fi
  sleep 1
done

if [ -z "${port:-}" ] || ! curl --fail --silent \
  -H "Authorization: Bearer $token" \
  "http://127.0.0.1:$port/healthz" | grep -q '"status":"ok"'; then
  docker logs "$container" >&2
  exit 1
fi

python3 "$here/chrono_smoke.py" http --port "$port" --token "$token"

python3 "$here/chrono_smoke.py" stdio -- \
  docker run --rm -i --name "$stdio_container" \
    --entrypoint deno \
    -e CHRONO_PYTHON=/opt/conda/bin/python \
    -e CHRONO_STORE_DIR=/data \
    -e DENO_DIR=/opt/deno \
    -e PYTHONDONTWRITEBYTECODE=1 \
    "$image" \
    run --cached-only --allow-env \
    --allow-read=/app,/data,/opt/deno --allow-write=/data \
    --allow-run=/opt/conda/bin/python \
    /app/server.ts --stdio

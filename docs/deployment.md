# Running and deployment

## Published stdio server

```sh
deno run -A jsr:@casys/mcp-chrono@0.3.4/server --stdio
```

The source process needs Python with exactly PyChrono / Project Chrono 10.0.0. Normal
tests use an injected runner and do not claim native execution.

## Run from a source checkout

HTTP on loopback:

```sh
deno run --allow-env=CHRONO_STORE_DIR,CHRONO_PYTHON,HOST,PORT \
  --allow-net=127.0.0.1:3025 --allow-read=. --allow-write=./data \
  --allow-run=python3 server.ts
```

Stdio without network permission:

```sh
deno run --allow-env=CHRONO_STORE_DIR,CHRONO_PYTHON --allow-read=. \
  --allow-write=./data --allow-run=python3 server.ts --stdio
```

The native entry point accepts only no arguments for HTTP or `--stdio`. Unknown or mixed
arguments fail closed. `CHRONO_PYTHON` selects the executable used for the fixed local
worker; it does not expose a caller-controlled script path.

The HTTP default is `127.0.0.1:3025` and storage defaults to `./data`. A direct
non-loopback source process requires the framework static-token configuration
`MCP_AUTH_TOKENS` and `MCP_AUTH_RESOURCE`.

## Published container

The Linux/amd64 image pins Deno and micromamba bases by digest, consumes the frozen Deno
lock, and installs the CPU-only SHA-256-pinned Conda transaction. The public boundary is
an in-image bearer proxy; the Deno MCP process remains on container loopback.

```sh
docker pull ghcr.io/casys-ai/mcp-chrono:0.3.4
docker volume create chrono-data
chrono_token="$(openssl rand -hex 32)"
docker run --rm \
  -e MCP_BEARER_TOKEN="$chrono_token" \
  -p 127.0.0.1:3025:3025 \
  -v chrono-data:/data \
  --cap-drop=ALL --security-opt no-new-privileges:true \
  ghcr.io/casys-ai/mcp-chrono:0.3.4
```

Use the immutable digest in [release.md](release.md) for production. Terminate TLS
outside the container, keep the token in a deployment secret store and back up the
`/data` volume.

## Compose

`deploy/compose.yaml` deliberately keeps a conservative digest fallback. Override
`CHRONO_IMAGE` only for an explicit upgrade or rollback:

```sh
cd deploy
cp .env.example .env
chmod 600 .env
# Replace the token and set an explicitly selected immutable image digest.
docker compose pull
docker compose up -d
docker compose ps
```

Do not use `docker compose down -v`: it deletes the content-addressed cases and request
ledger.

## Container verification

```sh
docker build --platform linux/amd64 -t mcp-chrono:local .
./scripts/docker-smoke.sh mcp-chrono:local
docker run --rm --entrypoint python mcp-chrono:local \
  /app/scripts/verify_image_notices.py
```

The smoke covers the authenticated HTTP/MCP path, exact request replay, conflict
handling, observed pose semantics and bounded readback. It does not broaden the
kinematics contract into contact, forces, dynamics or product proof.

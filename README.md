# Casys MCP Chrono

`@casys/mcp-chrono` is a small MCP provider for **explicit** prescribed rigid-body
kinematics using Project Chrono 10.0.0. Its current state is literal: the source
repository is public with GitHub private vulnerability reporting active, while **0.1.0
is prepared only**. A private VPS probe was deployed on 2026-08-27 with loopback-only
exposure; the JSR package, GHCR image, and release tag are not published.

It accepts a closed JSON mechanics case, records its exact UTF-8 bytes under SHA-256,
and returns factual engine observations. It can serve stateless HTTP or direct MCP
stdio. There is no UI in this version.

## Scope and boundary

The case schema is `chrono-prescribed-kinematics-case/1.0`. It fixes SI quantities to
metres, radians and seconds, and a right-handed frame. A case contains explicitly named
bodies with absolute zero-angle reference CoM poses, one fixed root, and an explicit
connected acyclic tree of revolute angle motors. Each joint includes an absolute
zero-angle reference joint frame whose local +Z is the positive rotation axis, a ramp
and declared angular limits.

The JSON field names remain literal: `absolute_com_pose` and `absolute_joint_frame`
describe the absolute reference configuration at motor angle zero. The worker then
applies each `initial_angle_rad` during assembly with `DoStepKinematics(0)`. Therefore,
the observed `t=0` sample is the assembled configuration after that application and may
differ from the submitted reference poses when an initial angle is non-zero.

The provider does not know Casys projects, Digital Thread, SysML, requirements, MRTR,
gates, or verdicts. Digital Thread integration is separate and unimplemented here. It
does not accept caller code, scripts or paths. It never derives joints, axes, frames,
units, masses, contact or other physical properties from a STEP file, a label or any
other external source.

Its returned `not_evaluated` list is literal: collision, clearance, contact, forces,
torques, dynamics, strength, safety and product fitness are not evaluated. In
particular, an observed declared-limit relation is not a product verdict.

## Contract

`chrono_case_submit` takes `case_json` as an exact UTF-8 string and its lower-case
`case_sha256`. The digest is recomputed and the JSON is validated before an immutable
write. Its identity is `chrono-case:sha256:<hex>`.

`chrono_run_prescribed_kinematics` takes a bounded safe `request_id`, case SHA-256, an
optional matching case URI and a bounded timeout. It reopens and rehashes exact stored
bytes before execution. Intent is persisted first. A successful run is stored atomically
as one record containing both its request ledger binding and output. Retrying a recorded
request returns that exact record; using its request ID for another case is a conflict.
A persisted intent without a result is returned as literal `uncertain` and is never
automatically rerun.

`chrono_run_get` exposes recorded, uncertain or absent state. The provider uses
identity-bound URIs and readback rather than pretending that dynamic case or run
resources have been registered.

`chrono_manifest_get` documents the provider identity and boundary at runtime. Tool
output is structured and error payloads use stable codes such as `case_invalid`,
`case_sha256_mismatch`, `request_conflict`, `run_uncertain`, `runner_timeout` and
`worker_failed`.

The HTTP integration uses the Casys MCP dialect implemented by the framework: protocol
version `2026-07-28` and its `server/discover` discovery exchange before a client
selects a registered method. This is a framework transport convention, not a claim that
this provider implements OAuth discovery or issues OAuth tokens.

The hard input limits are: at most 16 bodies; at most 15 joints; duration `> 0` and
`<= 10` seconds; positive step; at most 10,000 integration steps; positive
`sample_every_steps`; and no more than 512 returned samples. Objects reject unspecified
properties throughout.

## Quick start

Prerequisites for native execution are Python with **exactly** `pychrono` / Project
Chrono 10.0.0. Normal tests use an injected fake runner and do not assert native
execution.

```sh
deno task check
deno run --allow-env=CHRONO_STORE_DIR,CHRONO_PYTHON,HOST,PORT \
  --allow-net=127.0.0.1:3025 --allow-read=. --allow-write=./data \
  --allow-run=python3 server.ts
```

The default HTTP listener is `127.0.0.1:3025`; persisted data defaults to `./data`. For
stdio, use the direct application transport with no network permission:

```sh
deno run --allow-env=CHRONO_STORE_DIR,CHRONO_PYTHON --allow-read=. \
  --allow-write=./data --allow-run=python3 server.ts --stdio
```

`CHRONO_PYTHON` may name the Python executable. It changes only the executable used for
the fixed local `scripts/chrono_worker.py`; it does not open a caller-controlled script
or path surface. These local commands are loopback-only. Do not set `HOST` to a
non-loopback address without an authenticated boundary. A direct non-loopback native
HTTP process requires the framework's static token configuration `MCP_AUTH_TOKENS` and
`MCP_AUTH_RESOURCE`; it is distinct from the container proxy described below.

## Docker and VPS deployment

The Dockerfile is a linux/amd64 image. It pins the Deno and micromamba bases by digest,
uses `deno.lock` with `--frozen`, and installs the complete SHA-256-pinned Conda
transaction in `locks/pychrono-linux-64.explicit.txt`. Runtime uses cached Deno
dependencies and the exact verified interpreter `/opt/conda/bin/python`.

The container is intentionally network-facing only through an in-image bearer-token
proxy. It refuses to start unless `MCP_BEARER_TOKEN` is non-empty; the Deno MCP process
binds only to container loopback. The proxy accepts an opaque `Authorization: Bearer`
value and returns a standard Bearer challenge when it is missing or wrong. It is not an
OAuth authorization server: it has no issuer, discovery document, token endpoint or
token validation beyond that configured static secret. This is deliberately separate
from the native non-loopback static-token configuration above. Treat the token as a
secret and use a long random value. Health checks also require that bearer token.

Image status is deliberately literal: the image is **not license-cleared and not
published**. The public source repository does not make the package or image available.
`THIRD_PARTY_NOTICES.md`, the pinned Conda inventory and a future image SBOM identify
the dependency boundary, but they are not legal clearance to distribute the image.

```sh
docker build --platform linux/amd64 -t mcp-chrono:local .
docker run --rm -e MCP_BEARER_TOKEN="$(openssl rand -hex 32)" \
  -p 127.0.0.1:3025:3025 -v chrono-data:/data mcp-chrono:local
```

For a VPS, terminate TLS outside the container and protect the bearer token in the
deployment secret store. Preserve and back up the `/data` volume: it contains the
content-addressed cases and request ledger used for idempotency and uncertain-state
recovery.

`deploy/compose.yaml` is a minimal operator manifest for an already loaded private probe
image named `mcp-chrono:probe-20260827`. It reads `deploy/.env`, keeps `/data` in the
named `chrono-data` volume, binds only `127.0.0.1:3025:3025`, and runs without privilege
escalation. It does not build, pull, publish, or make an image available. Its
environment file must supply a non-empty `MCP_BEARER_TOKEN` and must not be committed.

## Native adapter notes

The fixed worker constructs `ChSystemNSC` with zero gravity, collision disabled and one
`ChLinkMotorRotationAngle` per explicit joint. It adds no separate revolute link. It
uses an explicit `DoStepKinematics(h)` loop with `h = min(step, target-current)`; it
does not substitute `DoFrameKinematics`. Native exit data is retained literally. A
literal `NOT_CONVERGED` is a recorded `execution_state: "not_converged"` observation,
never a fabricated convergence result. Constraint violation components remain split as
translation residual metres and quaternion-imaginary rotation residuals.

Native qualification was deliberately run privately on 2026-08-27. The linux/amd64 probe
image was `sha256:3bc07b0bf3bf40e0412141f5ffe1bfb4ae93d98dfeed09384211cf620640b381` at
6,127,610,043 bytes. `scripts/docker-smoke.sh` proved the authenticated HTTP/MCP path:
missing-bearer rejection, authenticated MCP calls, an off-axis one-joint π/2 pose and
quaternion, finite residual components, exact request replay, and request-ID conflict.
Separate native evidence on the current image established the non-zero initial-angle
semantics: from the zero-angle child reference `[1,0,0]`, `initial_angle_rad: 0.5` and
zero angular speed yield at `t=0` motor angle `0.5`, position `[cos(0.5),sin(0.5),0]`,
and quaternion `[cos(0.25),0,0,sin(0.25)]`. The smoke definition now repeats that second
zero-speed case, so future smoke runs enforce the same observed assembly rule. Separate
VPS probes established that the child binds to loopback and that SIGTERM exits with
status 0. This is private qualification of the named probe image only; it does not make
a package or OCI image public, published, or license-cleared.

## Development checks

```sh
deno fmt --check
deno task check
deno task lint
deno task test
deno publish --dry-run
```

CI runs the source checks plus a linux/amd64 container build and authenticated one-joint
native smoke. A release tag must exactly equal the package version, then pass the same
plain gates. Publication is disabled by default: both JSR and GHCR publication run only
when the repository Actions variable `CHRONO_RELEASE_ENABLED` is exactly `true`. Set
that variable only after explicit artifact clearance; a tag by itself never publishes
either artifact. JSR and GHCR are independent external transactions, so success of one
does not make the pair atomic and a failure after JSR can leave a package without its
image. On a future successful GHCR publish, the workflow requests a version tag, an
immutable commit-SHA tag, and BuildKit SBOM/provenance attestations; it never requests
`latest`. No public package, image, or release tag has been published. The private
loopback probe is the only deployment; it does not make any artifact public or
license-cleared.

## License

The source is MIT. The OCI image is an aggregate distribution; consult
`THIRD_PARTY_NOTICES.md`, the pinned Conda inventory, and the image SBOM/provenance
attestations for its dependency boundary.

# Casys MCP Chrono

`@casys/mcp-chrono` is a small MCP provider for **explicit** prescribed rigid-body
kinematics using Project Chrono 10.0.0. Version **0.3.1** is published on JSR and as a
public Linux/amd64 OCI image after the source, native smoke, notice and SBOM gates
passed:

```text
ghcr.io/casys-ai/mcp-chrono@sha256:b6302001725df4722d84096a51eeff7e7ffeee843690a2ba0cc417191c67683c
```

The immutable version tag is `ghcr.io/casys-ai/mcp-chrono:0.3.1`, and the published JSR
entry point is `jsr:@casys/mcp-chrono@0.3.1/server`. The checked-in operator Compose
fallback is deliberately not advanced by this documentation-only change; set
`CHRONO_IMAGE` to the qualified digest above for an explicit 0.3.1 deployment upgrade.

Version 0.3.1 is an upgrade reader for persistent `/data` volumes. It recognizes only
the exact 0.2 request-record shape and preserves its original request, case and output
for `chrono_case_get`, `chrono_run_get` and request-ID replay. Its bounded result labels
that data `legacy-0.2`, `unattested` and receipt `unavailable`; it does not fabricate a
receipt, outcome SHA-256, package/provider, worker or runtime identity. In particular,
`chrono_run_receipt_get` has no legacy lookup identity. A near-legacy or malformed
record is still corrupt, and legacy bytes are neither rewritten nor indexed. Valid 0.3.0
receipts remain verifiable and can repair a missing receipt index because that successor
mapping is derivable from their original receipt identity.

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

Version 1.0 has only those revolute angle motors and the linear
`angle(t) = initial_angle_rad + angular_speed_rad_s * t` profile. It has no prismatic
joints, non-linear profiles, contact, force or dynamics contract.

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

Read `chrono_manifest_get` before constructing a case. Its structured result carries the
complete `chrono-prescribed-kinematics-case/1.0` JSON Schema, SI units, cross-field
invariants, an exact example and the result-page contract. `chrono_case_template_get`
returns that non-executing example and its invariants alone.

`chrono_case_submit` takes `case_json` as an exact UTF-8 string. Its lower-case
`case_sha256` is optional: if supplied, it is an expected digest and a mismatch fails
before any write. The server always computes and returns the authoritative
`case_sha256`; mismatch details include `actual_case_sha256` for exact recovery. JSON is
validated before immutable storage under `chrono-case:sha256:<hex>`.

`chrono_run_prescribed_kinematics` takes a bounded safe `request_id`, case SHA-256, an
optional matching case URI and a bounded timeout. It reopens and rehashes exact stored
bytes before execution. Intent is persisted first. A successful request record is
published atomically with its ledger binding and output; its canonical receipt index is
then published from that immutable record. The receipt binds the case identity, outcome
SHA-256, package/provider/worker/runtime identities and literal execution state. A crash
between those two publications is repaired from the request record on the next request
identity lookup, without rerunning native Chrono. This repair applies only to attested
0.3 records; exact legacy 0.2 records have no receipt identity to derive. Retrying a
recorded request reuses that record; using its request ID for another case is a
conflict. A persisted intent without a result is returned as literal `uncertain` and is
never automatically rerun.

Run and readback responses expose an observation summary plus one `sample_page`, never
the full stored observation. Omit page arguments for the first 16 samples, or set
`sample_offset` and `sample_limit` (1–64) and continue while `has_more` is true.
`chrono_run_get` exposes recorded, uncertain or absent state through the same bounded
view. `chrono_case_get` rereads exact stored case bytes by case SHA-256;
`chrono_run_receipt_get` rereads an attested recorded run by receipt SHA-256 through the
same bounded page contract. These are identity readbacks, not dynamic MCP resources.

Tool output is structured and error payloads use stable codes such as `case_invalid`,
`case_sha256_mismatch`, `invalid_sample_offset`, `invalid_sample_limit`,
`request_conflict`, `run_uncertain`, `runner_timeout` and `worker_failed`.

The HTTP integration uses the Casys MCP dialect implemented by the framework: protocol
version `2026-07-28` and its `server/discover` discovery exchange before a client
selects a registered method. This is a framework transport convention, not a claim that
this provider implements OAuth discovery or issues OAuth tokens.

The hard input limits are: `case_json` at most 524288 UTF-8 bytes (512 KiB); at most 16
bodies; at most 15 joints; unique body IDs and unique joint IDs; duration `> 0` and
`<= 10` seconds; positive step; at most 10,000 integration steps; positive safe-integer
`sample_every_steps`; and no more than 512 stored samples. MCP readback is separately
bounded to a maximum 64-sample page. Objects reject unspecified properties throughout.

## Quick start

The public container is the recommended runtime path. Create a long random bearer token,
keep the service on host loopback, and preserve `/data`:

```sh
docker pull ghcr.io/casys-ai/mcp-chrono@sha256:b6302001725df4722d84096a51eeff7e7ffeee843690a2ba0cc417191c67683c
docker volume create chrono-data
chrono_token="$(openssl rand -hex 32)"
docker run --rm \
  -e MCP_BEARER_TOKEN="$chrono_token" \
  -p 127.0.0.1:3025:3025 \
  -v chrono-data:/data \
  --cap-drop=ALL --security-opt no-new-privileges:true \
  ghcr.io/casys-ai/mcp-chrono@sha256:b6302001725df4722d84096a51eeff7e7ffeee843690a2ba0cc417191c67683c
```

The MCP endpoint is `http://127.0.0.1:3025/mcp`. Requests must carry the same value as
`Authorization: Bearer <token>`. For a durable deployment, store the token in a
root-readable secret file rather than shell history and pin the published image digest,
as shown below.

### Run from source

Source execution is primarily for contributors and audits. It requires Python with
**exactly** `pychrono` / Project Chrono 10.0.0. Normal tests use an injected fake runner
and do not assert native execution.

With that exact native runtime available, the pinned JSR server entry point is:

```sh
deno run -A jsr:@casys/mcp-chrono@0.3.1/server --stdio
```

```sh
deno task check
deno run --allow-env=CHRONO_STORE_DIR,CHRONO_PYTHON,HOST,PORT \
  --allow-net=127.0.0.1:3025 --allow-read=. --allow-write=./data \
  --allow-run=python3 server.ts
```

The default HTTP listener is `127.0.0.1:3025`; persisted data defaults to `./data`. The
native entry point accepts exactly two transport forms: no CLI arguments for HTTP, or
the sole argument `--stdio` for direct application transport. It rejects mixed and
unknown arguments rather than silently changing transport. For stdio, use no network
permission:

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

The Dockerfile is a linux/amd64 image. It pins Deno **2.9.6** and micromamba bases by
digest, uses `deno.lock` with `--frozen`, and installs the CPU-only SHA-256-pinned Conda
transaction in `locks/pychrono-linux-64.explicit.txt`. The lock excludes CUDA, MKL, MPI,
OpenGL/X11, VTK and Irrlicht package families. Runtime uses cached Deno dependencies and
the exact verified interpreter `/opt/conda/bin/python`.

Every new 0.3.1 receipt contains the actual server `server_runtime.deno_version` that
created it. The published linux/amd64 image is expected to report `2.9.6`; source runs
record their own Deno version. This is runtime provenance for the receipt, not a claim
about an older record whose bytes did not contain it.

The container is intentionally network-facing only through an in-image bearer-token
proxy. It refuses to start unless `MCP_BEARER_TOKEN` is non-empty; the Deno MCP process
binds only to container loopback. The proxy accepts an opaque `Authorization: Bearer`
value and returns a standard Bearer challenge when it is missing or wrong. It is not an
OAuth authorization server: it has no issuer, discovery document, token endpoint or
token validation beyond that configured static secret. This is deliberately separate
from the native non-loopback static-token configuration above. Treat the token as a
secret and use a long random value. Health checks also require that bearer token.

The release image retains a versioned direct-notice bundle, the exact Conda recipes and
licence files, Ubuntu copyright files and cached npm notices. CI verifies those paths in
the final image. `THIRD_PARTY_NOTICES.md`, the image SBOM and BuildKit provenance record
the distribution boundary; the aggregate OCI licence remains `NOASSERTION` and must not
be described as MIT-only.

```sh
docker build --platform linux/amd64 -t mcp-chrono:local .
./scripts/docker-smoke.sh mcp-chrono:local
```

For a VPS, terminate TLS outside the container and protect the bearer token in the
deployment secret store. Preserve and back up the `/data` volume: it contains the
content-addressed cases and request ledger used for idempotency and uncertain-state
recovery.

`deploy/compose.yaml` is the release operator manifest. Its checked-in fallback remains
the previously qualified `0.2.0` digest; set `CHRONO_IMAGE` to the published `0.3.1`
Linux/amd64 digest above as an explicit upgrade. It keeps `/data` in the named
`chrono-data` volume, binds only `127.0.0.1:3025:3025`, drops capabilities and runs
without privilege escalation:

```sh
cd deploy
cp .env.example .env
chmod 600 .env
# Replace the token. Change CHRONO_IMAGE only for an explicit upgrade or rollback.
docker compose pull
docker compose up -d
docker compose ps
```

Back up `chrono-data` before an upgrade. Record the active digest, change only
`CHRONO_IMAGE`, then run `docker compose pull && docker compose up -d`. Rollback means
restoring the previous digest and running `up -d` again. Do not use `down -v`: that
deletes the content-addressed cases and request ledger.

## Native adapter notes

The fixed worker constructs `ChSystemNSC` with zero gravity, collision disabled and one
`ChLinkMotorRotationAngle` per explicit joint. It adds no separate revolute link. It
uses an explicit `DoStepKinematics(h)` loop with `h = min(step, target-current)`; it
does not substitute `DoFrameKinematics`. Native exit data is retained literally. A
literal `NOT_CONVERGED` is a recorded `execution_state: "not_converged"` observation,
never a fabricated convergence result. Constraint violation components remain split as
translation residual metres and quaternion-imaginary rotation residuals.

Native qualification was deliberately run privately on 2026-08-27. The historical
linux/amd64 probe image was
`sha256:3bc07b0bf3bf40e0412141f5ffe1bfb4ae93d98dfeed09384211cf620640b381` at
6,127,610,043 bytes. It predates the CPU-only lock and targeted data/demo pruning, so it
is not a claimed size for a new candidate. `scripts/docker-smoke.sh` proved the
authenticated HTTP/MCP path: missing-bearer rejection, authenticated MCP calls, an
off-axis one-joint π/2 pose and quaternion, finite residual components, exact request
replay, and request-ID conflict. Separate native evidence on that historical image
established the non-zero initial-angle semantics: from the zero-angle child reference
`[1,0,0]`, `initial_angle_rad: 0.5` and zero angular speed yield at `t=0` motor angle
`0.5`, position `[cos(0.5),sin(0.5),0]`, and quaternion `[cos(0.25),0,0,sin(0.25)]`. The
smoke definition now repeats that second zero-speed case, so future smoke runs enforce
the same observed assembly rule. Separate VPS probes established that the child binds to
loopback and that SIGTERM exits with status 0.

The last CPU-only private VPS probe used source commit
`05c0ba9b580a76d6bdb00f609dddc38a03c18e7b` as local Docker image ID
`sha256:fb3af9519ff60c1911221c2a3286a112eb7aeae6cd9c089f042d9a9275d62d3d` at
1,834,210,654 bytes, 70.1% below the historical image. Its `gzip -n` compressed Docker
export is 800,315,938 bytes. It passed the isolated native smoke and a live
authenticated manifest probe; that probe image is retained privately as the rollback
target. The CPU-only image removes unused Chrono datasets and PyChrono demos, then
validates the core import on the pruned tree; the worker does not call them. Native
smoke remains the oracle for that pruned image, while demo/data paths and modules that
depend on those assets are outside this provider's coverage. This is private
qualification of the named probe image only; it does not make a package or OCI image
public, published, or license-cleared.

The public `0.3.1` OCI index is
`sha256:b6302001725df4722d84096a51eeff7e7ffeee843690a2ba0cc417191c67683c`; its sole
Linux/amd64 runtime manifest is
`sha256:373be7bae6fed0518bcea6f8da29ae79259148083fbd3048170fbf52904fb795`, plus a
separate attestation manifest carrying BuildKit SBOM and provenance. The release
workflow rebuilt it, passed the authenticated native smoke and notice checks, and
validated the pinned Chrono/PyChrono components in the generated SBOM before publishing
the immutable GHCR `0.3.1` and commit tags and JSR `@casys/mcp-chrono@0.3.1`.

The previous public `0.1.0` OCI index is
`sha256:98a47f6a2aef49f429059692b1d4ee34feb361581768a1bd954d441ed7c450da`; its
Linux/amd64 runtime manifest is
`sha256:254927f8581e35f8fcc4e83f1fa92ec218e3c0d21e54dc0436651704bae6b7d6` and its
separate attestation manifest carries the BuildKit SBOM and provenance. The runtime
manifest contains 189,700,742 bytes of compressed layer and config content and expands
to 532,379,194 bytes under Docker on the VPS. The release-verify Docker export
compressed with `gzip -n` is 186,018,191 bytes. An empty Docker credential directory
successfully inspected and pulled the public digest; that downloaded artifact then
passed the native authenticated smoke and final-image notice verification. The private
VPS now runs this exact public digest on loopback with the existing `chrono-data`
volume; its authenticated manifest reports `@casys/mcp-chrono` version `0.1.0`, while an
unauthenticated health request remains `401`.

## Development checks

```sh
deno fmt --check
deno task check
deno task lint
deno task test
deno publish --dry-run
```

CI runs the source checks plus a Linux/amd64 container build and authenticated native
smoke. Each candidate emits its image ID, exact Docker image size, a `gzip -n`
compressed `docker save` byte size, layer history, a final-image notice check and an
SPDX SBOM. CI explicitly enables Syft's Conda metadata cataloger and fails unless the
SBOM contains the pinned Chrono and PyChrono versions without the excluded package
families.

A release tag must exactly equal the package version and pass the same gates. GHCR and
JSR are deliberately separate external transactions:

- `CHRONO_GHCR_RELEASE_ENABLED=true` enables only the version and immutable commit-SHA
  GHCR tags with BuildKit SBOM/provenance attestations;
- `CHRONO_JSR_RELEASE_ENABLED=true` enables only `deno publish`.

The GHCR path never publishes `latest`, and it refuses to overwrite an existing version
or commit tag. Keep either variable disabled until that exact artifact is explicitly
authorized.

## License

The source is MIT. The OCI image is an aggregate distribution; consult
`THIRD_PARTY_NOTICES.md`, the pinned Conda inventory, and the image SBOM/provenance
attestations for its dependency boundary.

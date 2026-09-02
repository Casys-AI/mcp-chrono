# Changelog

## Unreleased

- The run-record viewer now boots through `startPreactSurfaceApp` from
  `@casys/mcp-view-components@0.6.0` instead of a hand-written App lifecycle. Tool
  results and `viewer.session.apply` sessions still go through the strict `model.ts` and
  `viewer-session.ts` parsers; the shared lifecycle owns view routing, host surface
  selection and the pre-connect session buffer.
- Removed the local `session-receiver.ts` buffer. `@casys/mcp-view@0.9.2` delivers
  sessions in order and holds those received before the App activates, which is the
  guarantee the shim provided.
- Status states render through the shared `StateMessage` primitive with the
  `chrono-viewer-state` class. Unresolved and unavailable recorded runs are warning
  notices whose `code` carries the ledger status; a session the strict parser refuses is
  a danger state titled `Session rejected` with code `session-rejected`; a tool result
  the projection cannot read is the shared `Result rejected` state; a viewer that cannot
  start shows `Chrono viewer unavailable`. Loading states carry the shared `Loading`
  title and `info` tone, empty states the `Empty` title and error results the `Error`
  title.
- Pins the split View checkout to the `mcp-server` revision that carries
  `@casys/mcp-view-components@0.6.0`. That revision is not on the `mcp-server` default
  branch yet and 0.6.0 is unpublished: do not tag a Chrono release until the pin moves
  to a durable revision.

## 0.3.3 — 2026-08-31

- Added and served an exact serialized MCP View App manifest for the Chrono run-record
  viewer, including `viewer.session.apply` and its provider-owned recorded-run session
  schema.
- Recorded sessions now join the host anchor to the canonical receipt, rehash the
  receipt preimage and complete durable outcome, and preserve literal unavailable or
  unresolved states.
- Replaced the former four-entry viewer catalog with exactly one flat, responsive
  `chrono.recorded-run` business component. It contains only the run identity, factual
  sample/execution readings and receipt provenance, with no verdict, limit or tone.
- Reworked the root README as a concise product entrance and moved the case, viewer,
  deployment, native-adapter and release details under `docs/`.
- Added a contract-validated documentation fixture and a visibly labelled viewer
  screenshot. The fixture is presentation evidence only, not a native Chrono execution
  or engineering proof.

## 0.3.2 — 2026-08-31

- Fixed the 0.3.1 prescribed-kinematics terminal-tick defect. IEEE-754 accumulation of
  admitted `step_s` values can land one ULP short of `duration_s`. A time-closeness
  terminator either took a leftover epsilon step or relabelled an interior engine tick
  as the requested duration. The worker now uses a bounded planned-step loop:
  `ceil(duration_s / step_s)` steps, interior `min(step, remaining)`, the last planned
  index consumes the actual positive remainder, and published sample times come only
  from Chrono's `GetChTime()`; they are never relabelled to the target.
- Coverage is the admitted 1.0 case contract: duration/step ratio at most 10,000,
  including the live `0.1`×10 schedule, non-dividing durations, tiny and subnormal
  admitted ratios, and the 10,000-step cadence-20 page. Native smoke remains the
  qualification oracle. This does not add contact, forces, dynamics, a new receipt
  schema, a rewritten durable record, or a Compose fallback change.
- Breaking durable-record authority: 0.3.2 reads only exact 0.3.2 attested run receipts.
  A pre-receipt 0.2 or attested 0.3.0/0.3.1 record encountered on `/data` fails closed
  as unsupported/corrupt. Bytes on disk are neither migrated, deleted, rewritten nor
  relabelled.
- Published JSR `@casys/mcp-chrono@0.3.2` and public Linux/amd64 OCI index
  `sha256:2e9b7d5b27e344499fe233ff4e0a1fcdbbe77c8f83bd78ee0cdbc26eb7a74557`. The
  immutable GHCR `0.3.2` and `sha-18e118453111391eae632f8f5ec737e6c9f04847` tags resolve
  to that index, whose OCI revision is `18e118453111391eae632f8f5ec737e6c9f04847`; a
  fresh exact JSR import succeeded.

## 0.3.1 — 2026-08-28

- Restored truthful read compatibility for an exact pre-receipt 0.2 durable request
  record. It keeps the original request, case and observation replayable by request ID
  and case SHA-256, while exposing `legacy-0.2`, `unattested` and `unavailable`
  provenance instead of synthesizing a receipt, outcome digest, package/provider, worker
  or runtime identity. Malformed near-legacy records remain corrupt.
- Kept receipt-index recovery strictly limited to attested 0.3 records, including an
  existing valid 0.3.0 record whose index is absent after an interrupted write. Legacy
  records are never rewritten or indexed because the required identity facts are not
  derivable from their bytes.
- New 0.3.1 receipts identify the actual server Deno runtime that created them. The
  linux/amd64 Docker runtime is Deno 2.9.6, pinned by OCI digest; release CI selects the
  exact `v2.9.6` toolchain tag. This does not retroactively assert that identity for 0.2
  or 0.3.0 data.
- Published JSR `@casys/mcp-chrono@0.3.1` and the public Linux/amd64 OCI index
  `sha256:b6302001725df4722d84096a51eeff7e7ffeee843690a2ba0cc417191c67683c` after the
  native smoke, notice and SBOM gates passed.

## 0.3.0 — 2026-08-28

- Added a canonical, content-addressed prescribed-kinematics receipt. It binds the exact
  case SHA-256, outcome SHA-256, request identity, package/provider/worker/runtime
  identities and literal execution state; it remains factual provenance, never a product
  verdict.
- Added read-only `chrono_case_get` and `chrono_run_receipt_get` identity readbacks.
  Cases return their original UTF-8 bytes. Recorded observations remain paged, including
  when read by receipt identity.
- Made `motor_angle_rad` mandatory in every motor observation and reject a worker whose
  literal raw kinematics exit code and name disagree.
- Published JSR `@casys/mcp-chrono@0.3.0` and the public Linux/amd64 OCI image at
  immutable index
  `sha256:39eb29a2ba2de72d2af1fefe0897650674d9bb519f866ec2874472facf71ea5c` after the
  native smoke, notice and SBOM gates passed.

## 0.2.0 — 2026-08-28

- Added a complete runtime case contract: structural JSON Schema, valid non-executing
  template, fixed units, server-validated invariants and an agent workflow in
  `chrono_manifest_get`; `chrono_case_template_get` exposes the template directly.
- Made `chrono_case_submit.case_sha256` optional. The provider now computes and returns
  the authoritative digest; a supplied expected digest still fails closed on mismatch
  and reports the actual digest for recovery.
- Replaced full observation payloads on MCP run/readback with a factual summary and a
  deterministic bounded sample page. The complete observation remains in the durable
  request ledger.
- Kept the mechanics case at `chrono-prescribed-kinematics-case/1.0`: explicit revolute
  angle ramps only. Prismatic joints, other profiles, contact, forces and dynamics are
  not added by this release candidate.
- Published JSR 0.2.0 and the public Linux/amd64 image at immutable OCI index
  `sha256:b9332fdf44634a565596d5cee6e64c9735b35d22299fab806631eaf86aa479a6` after the
  native smoke, notice and SBOM gates passed.

## 0.1.0 — 2026-08-27

- Replaced the native lock with a CPU-only conda-forge transaction pinned to the exact
  Project Chrono and PyChrono builds. Build and CI gates reject CUDA, MKL, MPI, and
  OpenGL/X11, VTK and Irrlicht package families.
- Removed unused Chrono datasets, PyChrono demos, and Python bytecode caches after
  verifying their paths and the pinned package metadata, then validated the native
  import and required symbols on the pruned tree. The native container smoke remains the
  qualification oracle for the resulting image.
- Preserved exact Conda recipes, metadata and licence files in a generated runtime
  notice bundle, then removed the extracted Conda package cache. Added final-image
  notice gates for the Conda, Ubuntu and npm runtime boundaries.
- Added candidate image-size, compressed image-export, layer-history, and SPDX SBOM
  evidence. The SBOM gate explicitly requires the pinned Chrono/PyChrono components and
  rejects the excluded package families.
- Added the Linux/amd64 explicit Project Chrono transaction, frozen Deno dependency
  cache, authenticated container boundary, and native MCP smoke definition.
- Added release provenance/SBOM configuration and separate strict opt-in publication
  gates. `CHRONO_GHCR_RELEASE_ENABLED` cannot invoke JSR publication, and
  `CHRONO_JSR_RELEASE_ENABLED` cannot publish an image.
- Recorded private linux/amd64 probe qualification: `docker-smoke` covered
  authentication, MCP, the one-joint π/2 pose, residuals and replay/conflict. Separate
  VPS probes covered child loopback binding and SIGTERM exit status 0.
- Deployed the CPU-only private loopback probe from source commit `05c0ba9`; its
  isolated native smoke and live authenticated manifest probe passed, while the
  historical image remains available as a private rollback target.
- Clarified that submitted absolute poses are zero-angle references; an observed `t=0`
  sample follows assembly with `initial_angle_rad` applied and may differ.
- Extended the authenticated Docker smoke definition with a zero-speed `0.5` rad
  initial-angle reference case that asserts the assembled `t=0` pose and quaternion.
- Published the public Linux/amd64 image with immutable version and commit tags,
  BuildKit SBOM/provenance attestations and no `latest` tag. Anonymous digest
  inspection, pull and native smoke passed. The JSR package is registered separately and
  remains unpublished.
- Deployed the public digest to the private VPS on loopback while preserving the
  existing data volume, bearer boundary and private rollback image.
- Initial bounded provider for explicit Project Chrono prescribed rigid-body kinematics,
  with content-addressed cases, an immutable request ledger, and HTTP and stdio
  transports.

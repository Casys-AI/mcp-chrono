# Changelog

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

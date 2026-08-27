# Changelog

## Unreleased — release hardening

- Replaced the native lock with a CPU-only conda-forge transaction pinned to the exact
  Project Chrono and PyChrono builds. Build and CI gates reject CUDA, MKL, MPI, and
  OpenGL/X11, VTK and Irrlicht package families.
- Removed unused Chrono datasets, PyChrono demos, and Python bytecode caches after
  verifying their paths and the pinned package metadata, then validated the native
  import and required symbols on the pruned tree. The native container smoke remains the
  qualification oracle for the resulting image.
- Added candidate image-size, compressed image-export, layer-history, and SPDX SBOM
  evidence before publication review. The SBOM gate explicitly requires the pinned
  Chrono/PyChrono components and rejects the excluded package families. This evidence
  does not clear the image for distribution.
- Added the Linux/amd64 explicit Project Chrono transaction, frozen Deno dependency
  cache, authenticated container boundary, and native MCP smoke definition.
- Added release provenance/SBOM configuration and a strict opt-in publication gate. JSR
  and GHCR publication require `CHRONO_RELEASE_ENABLED=true` after explicit artifact
  clearance; a tag alone does not publish.
- Recorded private linux/amd64 probe qualification: `docker-smoke` covered
  authentication, MCP, the one-joint π/2 pose, residuals and replay/conflict. Separate
  VPS probes covered child loopback binding and SIGTERM exit status 0.
- Clarified that submitted absolute poses are zero-angle references; an observed `t=0`
  sample follows assembly with `initial_angle_rad` applied and may differ.
- Extended the authenticated Docker smoke definition with a zero-speed `0.5` rad
  initial-angle reference case that asserts the assembled `t=0` pose and quaternion.
- The source repository is public with GitHub private vulnerability reporting active.
  The JSR package, GHCR image, and release tag remain unpublished, and the image is not
  license-cleared.

## 0.1.0 — prepared

- Initial bounded provider for explicit Project Chrono prescribed rigid-body kinematics.
- Content-addressed cases, immutable request ledger, HTTP and stdio transports.
- Prepared only; not published. Native probe qualification is recorded under Unreleased
  and does not make an artifact publicly available.

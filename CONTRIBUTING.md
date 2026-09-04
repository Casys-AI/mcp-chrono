# Contributing

This provider is intentionally limited to explicit Project Chrono prescribed kinematics.
Changes must preserve that boundary: no caller-provided code, paths, inferred joints,
product verdicts, or Digital Thread integration.

Viewer HTML is generated, never hand-edited. After changing `src/ui/run-record-viewer/`,
set the audited mcp-server split roots at commit
`676a2c7379c6be9fe69a6b06da244178088b5e5a` and run `deno task build:ui`. CI rebuilds
that bundle with `--frozen` and fails unless `git diff` would see no HTML drift.

Before proposing a change, run the documented Deno checks. Container changes must keep
the Linux/amd64 CPU-only explicit lock, non-root runtime, loopback-only Deno service,
and authenticated public proxy aligned. Regenerate the lock from the solver JSON's full
transaction, using the solver command and resolver digest recorded in its header; retain
each resolver-supplied package URL and SHA-256 fragment rather than hand-picking direct
dependencies. Then update the exact Chrono/PyChrono metadata assertions and lock tests.
The lock and CI must continue to reject CUDA, MKL, MPI, OpenGL/X11, VTK and Irrlicht
package families. Validate a changed container through the native Docker smoke and
candidate SBOM evidence before seeking artifact clearance. Do not commit credentials,
bearer tokens, `/data`, generated native artifacts, or dependency caches.

Report security-sensitive defects through the private route described in
[SECURITY.md](SECURITY.md), not a public issue.

# Contributing

This provider is intentionally limited to explicit Project Chrono prescribed kinematics.
Changes must preserve that boundary: no caller-provided code, paths, inferred joints,
product verdicts, or Digital Thread integration.

Before proposing a change, run the documented Deno checks. Container changes must keep
the Linux/amd64 explicit lock, non-root runtime, loopback-only Deno service, and
authenticated public proxy aligned. Do not commit credentials, bearer tokens, `/data`,
generated native artifacts, or dependency caches.

Report security-sensitive defects through the private route described in
[SECURITY.md](SECURITY.md), not a public issue.

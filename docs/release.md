# Release and registry evidence

## Current release line

Source version `0.3.3` is the viewer-contract release. Its immutable JSR and GHCR
identities are recorded here after the tag workflow and fresh-consumption checks pass.

Until that transaction is complete, the last verified published identities remain:

- JSR: `jsr:@casys/mcp-chrono@0.3.2/server`
- GHCR index:
  `ghcr.io/casys-ai/mcp-chrono@sha256:2e9b7d5b27e344499fe233ff4e0a1fcdbbe77c8f83bd78ee0cdbc26eb7a74557`
- release commit: `18e118453111391eae632f8f5ec737e6c9f04847`

The version and commit tags for that image resolve to the same Linux/amd64 OCI index.
The index includes a separate BuildKit SBOM/provenance attestation.

## Release gate

```sh
deno task release:check
```

CI additionally rebuilds the Linux/amd64 image, runs the authenticated native smoke,
verifies final-image notices, records image identity and layer history, and produces an
SPDX SBOM with the Conda cataloger enabled. The SBOM gate requires the pinned Chrono and
PyChrono packages and rejects the excluded GPU, MPI and desktop graphics families.

A release tag must equal the package version. Publication is split into independent,
explicitly authorized transactions:

- `CHRONO_JSR_RELEASE_ENABLED=true` enables JSR publication only;
- `CHRONO_GHCR_RELEASE_ENABLED=true` enables immutable version and commit-SHA GHCR tags
  with SBOM/provenance attestations only.

The workflow never publishes `latest` and refuses to overwrite an existing immutable
GHCR tag. A source version alone is not registry evidence; verify JSR import and GHCR
inspection/pull independently after every tag.

Published historical identities remain in [the changelog](../CHANGELOG.md).

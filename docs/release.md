# Release and registry evidence

## Current release line

Source version `0.3.4` is the next release line; the source version alone is not
registry evidence, and no `0.3.4` artifact exists until its own tag workflow and
fresh-consumption checks pass. The last verified published identities are those of
`0.3.3`, published from tag `v0.3.3` and commit
`3776c95215e9ff2ee317576b46070e2fa7fb5aca`:

- JSR: `jsr:@casys/mcp-chrono@0.3.3/server`
- GHCR index:
  `ghcr.io/casys-ai/mcp-chrono@sha256:c362fe99f1fe0ef3dfcf29f63fe29ba610e0b980b04c4691802ddf303cc58395`

The version and commit-SHA tags resolve to that same Linux/amd64 OCI index. A fresh JSR
import with the new-version age override and a cached-only repeat both succeeded. The
index includes separate BuildKit SBOM and provenance attestations.

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

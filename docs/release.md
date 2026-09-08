# Release and registry evidence

## Current source line

Source version `0.3.5` is the next release line. The source version alone is not
registry evidence; no `0.3.5` artifact exists until its own tag workflow and fresh
consumption checks pass. The last verified published identities are `0.3.4`, recorded
below.

## Recorded 0.3.4 publication

Version `0.3.4` was published from tag `v0.3.4` and commit
`f40659ab8bdb29c7e474ee4bd43720cbe1a2f7d6`:

- JSR: `jsr:@casys/mcp-chrono@0.3.4/server`
- GHCR index:
  `ghcr.io/casys-ai/mcp-chrono@sha256:3b6bff8661e7b985630c64b22f219f5bc4d5a21a0fcf3632b8c07a7ba5a5e2e3`

These identities are historical registry evidence recorded after publication. They are
not a pre-publication oracle for a later tag. The release workflow completed
successfully. Post-publication inspection confirmed the JSR metadata at `0.3.4` and the
Linux/amd64 OCI index above.

## Previous recorded publication

Version `0.3.3` was published from tag `v0.3.3` and commit
`3776c95215e9ff2ee317576b46070e2fa7fb5aca`:

- JSR: `jsr:@casys/mcp-chrono@0.3.3/server`
- GHCR index:
  `ghcr.io/casys-ai/mcp-chrono@sha256:c362fe99f1fe0ef3dfcf29f63fe29ba610e0b980b04c4691802ddf303cc58395`

The version and commit-SHA tags resolve to that same Linux/amd64 OCI index. A fresh JSR
import with the new-version age override and a cached-only repeat both succeeded. The
index includes separate BuildKit SBOM and provenance attestations.

## Packaged documentation

A packaged README names this source version as a JSR specifier and a GHCR version tag.
It does not embed a newly produced OCI digest. Immutable JSR documentation already
published, including `0.3.1`, remains as published and is not repaired by later source
or documentation commits.

`deploy/compose.yaml` keeps the qualified `0.2.0` digest fallback. Changing that image
is an explicit operator upgrade, not a documentation wording fix.

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
GHCR tag. After both JSR and GHCR publication succeed, it verifies the exact released
JSR version metadata, compares the packaged `deno.json` and `README.md` with the tagged
checkout, and checks that the GHCR version and commit tags resolve to one artifact whose
OCI version and revision labels match the release version and tag commit. Public GHCR
inspection uses the anonymous registry token exchange. The registry-fetched digest is
recorded as workflow evidence and as GitHub Release notes for that new tag. The workflow
does not create historical GitHub Releases.

A source version alone is not registry evidence; verify JSR import and GHCR
inspection/pull independently after every tag.

Published historical identities remain in [the changelog](../CHANGELOG.md).

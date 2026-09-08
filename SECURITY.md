# Security policy

## Reporting

Do not disclose vulnerabilities in a public issue. The source repository is public and
GitHub private vulnerability reporting is active through its Security tab. Source
visibility is independent of package publication.

Name the affected package version, commit, or a verified registry identity from
[release documentation](docs/release.md). Pin an exact registry identity rather than
inferring it from source version alone. This file does not assert that a JSR version or
OCI digest has already been published.

Include the affected version or commit, deployment boundary, and safe reproduction
steps. Do not attach real bearer tokens, persisted `/data` records, or customer data.

## Supported releases

Security fixes target the `0.3.4` release line packaged with this source and the
previous qualified `0.3.3` artifact. Older image digests receive no separate support
commitment. Follow repository releases for replacements. Published registry identities
are recorded after publication; they are not asserted by this file.

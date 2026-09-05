# Security policy

## Reporting

Do not disclose vulnerabilities in a public issue. The source repository is public and
GitHub private vulnerability reporting is active through its Security tab. Source
visibility is independent of package publication. Security reports may name the
published `0.3.4` GHCR image index
`sha256:3b6bff8661e7b985630c64b22f219f5bc4d5a21a0fcf3632b8c07a7ba5a5e2e3` or the
previous qualified `0.3.3` image identified by digest
`sha256:c362fe99f1fe0ef3dfcf29f63fe29ba610e0b980b04c4691802ddf303cc58395`. Pin an exact
registry identity rather than inferring it from source version alone.

Include the affected version or commit, deployment boundary, and safe reproduction
steps. Do not attach real bearer tokens, persisted `/data` records, or customer data.

## Supported releases

Security fixes target the current `0.3.4` release line and the previous `0.3.3`
artifact; older image digests receive no separate support commitment. Pin a verified
digest for deployment identity and follow repository releases for replacements.

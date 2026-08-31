# Security policy

## Reporting

Do not disclose vulnerabilities in a public issue. The source repository is public and
GitHub private vulnerability reporting is active through its Security tab. Source
visibility is independent of package publication. Security reports may name release line
`0.3.2` or the previous qualified `0.3.1` GHCR image identified by digest
`sha256:b6302001725df4722d84096a51eeff7e7ffeee843690a2ba0cc417191c67683c`. Independent
registry verification is required before treating an external JSR or GHCR transaction as
complete.

Include the affected version or commit, deployment boundary, and safe reproduction
steps. Do not attach real bearer tokens, persisted `/data` records, or customer data.

## Supported releases

Security fixes target the current `0.3.2` release line and the previous `0.3.1`
artifact; older image digests receive no separate support commitment. Pin a verified
digest for deployment identity and follow repository releases for replacements.

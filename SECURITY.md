# Security policy

## Reporting

Do not disclose vulnerabilities in a public issue. The source repository is public and
GitHub private vulnerability reporting is active through its Security tab. Source
visibility is independent of package publication. The `0.1.0` GHCR image is a release
candidate at this commit; the JSR package is registered separately and has no published
version.

Include the affected version or commit, deployment boundary, and safe reproduction
steps. Do not attach real bearer tokens, persisted `/data` records, or customer data.

## Supported releases

Before the first GHCR publication, security fixes target the `main` source branch. Once
`0.1.0` is public, fixes target that current release and `main`; older image digests
receive no separate support commitment. Pin the post-publication digest for deployment
identity and follow repository releases for replacements.

# Security policy

## Reporting

Do not disclose vulnerabilities in a public issue. The source repository is public and
GitHub private vulnerability reporting is active through its Security tab. Source
visibility is independent of package publication. The public `0.1.0` GHCR image is
identified by digest
`sha256:98a47f6a2aef49f429059692b1d4ee34feb361581768a1bd954d441ed7c450da`; the JSR
package is registered separately and has no published version.

Include the affected version or commit, deployment boundary, and safe reproduction
steps. Do not attach real bearer tokens, persisted `/data` records, or customer data.

## Supported releases

Security fixes target the current `0.1.0` release and `main`; older image digests
receive no separate support commitment. Pin the published digest for deployment identity
and follow repository releases for replacements.

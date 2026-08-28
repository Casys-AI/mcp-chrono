# Corresponding source availability

The image SBOM and BuildKit provenance identify the final binary inventory and base
digest. The following locations provide the corresponding source and build material for
the components selected directly by this repository:

| Component | Exact release or inventory | Source |
| --- | --- | --- |
| Casys MCP Chrono | OCI revision label and Git tag | <https://github.com/Casys-AI/mcp-chrono> |
| Deno | `v2.9.6` | <https://github.com/denoland/deno/tree/v2.9.6> |
| micromamba | `2.3.1` | <https://github.com/mamba-org/mamba/tree/2.3.1> |
| micromamba Docker base | digest pinned in `Dockerfile`, generated from `v2.3.1` | <https://github.com/mamba-org/micromamba-docker/tree/v2.3.1> |
| Project Chrono and PyChrono | `10.0.0` | <https://github.com/projectchrono/chrono/tree/10.0.0> |
| Conda runtime closure | exact URLs and SHA-256 values in `locks/pychrono-linux-64.explicit.txt` | <https://github.com/conda-forge> |
| Ubuntu base packages | exact binary versions in the image SBOM and `/var/lib/dpkg/status` | <https://launchpad.net/ubuntu/noble/+sources> |
| npm runtime packages | exact versions in the image SBOM and `deno.lock` | <https://registry.npmjs.org/> |
| Casys MCP server | `@casys/mcp-server@0.26.1` | <https://jsr.io/@casys/mcp-server@0.26.1> |
| Deno standard YAML | `@std/yaml@1.2.0` | <https://jsr.io/@std/yaml@1.2.0> |

For every Conda package, the image also retains `info/index.json`, `info/about.json`,
the complete `info/recipe/` tree and `info/licenses/` tree from the exact downloaded
archive. Those files include the conda-forge recipe, upstream source URLs and hashes,
patches, declared licence and supplied notices. Ubuntu copyright files and common
licence texts remain in their standard image paths.

Requests concerning a source archive or relinking material for this image may be made
through the private vulnerability/contact path documented in `SECURITY.md` or through a
GitHub issue when the request is not security-sensitive.

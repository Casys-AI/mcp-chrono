# Third-party notices and runtime inventory boundary

This repository's source is MIT-licensed under [LICENSE](LICENSE). The OCI image is an
aggregate distribution and must not be described as MIT-only.

The image contains these directly selected components:

- Deno `2.9.2`, copied from the digest-pinned `denoland/deno:bin-2.9.2` image.
- micromamba, supplied by the digest-pinned `mambaorg/micromamba` base image.
- Project Chrono `10.0.0=py312h14c7f5c_0` and PyChrono `10.0.0=py312h3a49c4c_0`, from
  conda-forge. Their resolver metadata declares BSD 3-Clause.
- The CPU-only Linux/amd64 Conda closure in
  [locks/pychrono-linux-64.explicit.txt](locks/pychrono-linux-64.explicit.txt). Every
  archive URL is SHA-256 pinned; CUDA, MKL, MPI, OpenGL/X11, VTK and Irrlicht package
  families are excluded by the lock and CI gate.

The versioned [LICENSES](LICENSES/) bundle reproduces the Deno, direct JSR, micromamba
and Project Chrono notices, the micromamba-docker attribution, the SQLite public-domain
blessing, and the corresponding-source locations for the selected runtime. The final
image keeps that bundle at `/usr/share/licenses/mcp-chrono/`.

Before deleting the large Conda package cache, the build copies `info/index.json`,
`info/about.json`, the complete `info/licenses/` tree and the complete `info/recipe/`
tree from every exact archive into `/opt/conda/share/mcp-chrono/conda-notices/`. Its
generated manifest records the declared licence and retained files for every installed
Conda metadata record. Ubuntu copyright files remain under `/usr/share/doc/`, common
licence texts remain under `/usr/share/common-licenses/`, and cached npm packages retain
their package metadata and notice files under `/opt/deno/npm/registry.npmjs.org/`.

CI and release verification fail closed if those final-image notice boundaries do not
cover the installed Conda metadata, Ubuntu packages and cached npm packages. They also
generate an SPDX SBOM with the Conda cataloger explicitly enabled and gate the pinned
Chrono/PyChrono components and CPU-only exclusions. A GHCR release additionally carries
BuildKit SBOM and provenance attestations.

The lock, notices, SBOM and provenance are complementary records. The aggregate OCI
licence label remains `NOASSERTION`; do not describe the image as MIT-only or infer
legal advice from this technical inventory.

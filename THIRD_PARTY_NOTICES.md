# Third-party notices and inventory boundary

This repository's source is MIT-licensed under [LICENSE](LICENSE). The OCI image is an
aggregate distribution and must not be described as MIT-only.

The image contains these directly selected components:

- Deno `2.9.2`, copied from the digest-pinned `denoland/deno:bin-2.9.2` image.
- micromamba, supplied by the digest-pinned `mambaorg/micromamba` base image.
- Project Chrono / PyChrono `10.0.0=py312h98ab86c_677`, from the Project Chrono Conda
  channel. Its resolver metadata declares BSD 3-Clause.
- The complete 206-package Linux/amd64 Conda closure in
  [locks/pychrono-linux-64.explicit.txt](locks/pychrono-linux-64.explicit.txt). Every
  archive URL is SHA-256 pinned.

The lock is an inventory and integrity record, not a substitute for upstream license
texts, source-offer, relinking, or notice obligations. The release workflow attaches an
OCI SBOM and provenance attestation for the built image; maintainers must review those
artifacts and the final image before publication. Do not claim an aggregate SPDX license
until that review is complete.

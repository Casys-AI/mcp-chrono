# Third-party notices and inventory boundary

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

The lock is an inventory and integrity record, not a substitute for upstream license
texts, source-offer, relinking, or notice obligations. Candidate CI and release-verify
builds generate an SPDX SBOM; maintainers must review that SBOM and the final image
before publication, then review generated provenance if the image is published. This
remains evidence for review, not artifact clearance. Do not claim an aggregate SPDX
license until that review is complete.

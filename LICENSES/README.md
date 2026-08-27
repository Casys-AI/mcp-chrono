# Runtime licence bundle

These files accompany the native OCI image. They include the direct Deno, JSR, native
engine and base-image notices, and supplement the package-specific notices retained
inside the image:

- `/usr/share/licenses/mcp-chrono/` contains the notices versioned here;
- `/opt/conda/share/mcp-chrono/conda-notices/` contains the licence files, recipes and
  metadata extracted from the exact Conda packages before their build cache is removed;
- `/usr/share/doc/*/copyright` and `/usr/share/common-licenses/` come from the pinned
  Ubuntu-based micromamba image; and
- `/opt/deno/npm/registry.npmjs.org/` retains the licence file and package metadata for
  each cached npm runtime dependency.

The aggregate OCI label remains `NOASSERTION`: this bundle records the redistribution
boundary without pretending that every component shares the repository's MIT licence.
See [SOURCE_AVAILABILITY.md](SOURCE_AVAILABILITY.md) for the corresponding source paths.

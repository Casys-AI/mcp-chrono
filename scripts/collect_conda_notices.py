#!/usr/bin/env python3
"""Retain exact Conda recipes and notices before deleting the package cache."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


NOTICE_PREFIXES = (
    "license",
    "licence",
    "copying",
    "notice",
    "copyright",
)
NOTICE_OPTIONAL_LICENSES = {
    "blessing",
    "licenseref-public-domain",
    "public-domain",
}


def is_notice(path: Path) -> bool:
    name = path.name.lower()
    return any(name == prefix or name.startswith(prefix + ".") for prefix in NOTICE_PREFIXES)


def copy_tree(source: Path, destination: Path) -> list[str]:
    copied: list[str] = []
    if not source.exists():
        return copied
    for path in sorted(item for item in source.rglob("*") if item.is_file()):
        target = destination / path.relative_to(source.parent)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        copied.append(target.as_posix())
    return copied


def collect(cache: Path, bundle: Path) -> dict[str, object]:
    if not cache.is_dir():
        raise RuntimeError(f"Conda package cache is missing: {cache}")
    if bundle.exists():
        shutil.rmtree(bundle)
    bundle.mkdir(parents=True)

    packages: list[dict[str, object]] = []
    for package in sorted(path for path in cache.iterdir() if (path / "info/index.json").is_file()):
        index_path = package / "info/index.json"
        index = json.loads(index_path.read_text(encoding="utf-8"))
        declared_license = str(index.get("license", "")).strip()
        if not declared_license:
            raise RuntimeError(f"Conda package has no declared licence: {package.name}")

        package_bundle = bundle / package.name
        copied: list[str] = []
        for metadata_name in ("index.json", "about.json"):
            source = package / "info" / metadata_name
            if source.is_file():
                target = package_bundle / "info" / metadata_name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
                copied.append(target.relative_to(bundle).as_posix())
        for tree_name in ("licenses", "recipe"):
            copied.extend(
                Path(path).relative_to(bundle).as_posix()
                for path in copy_tree(package / "info" / tree_name, package_bundle / "info")
            )

        notice_files = sorted(path for path in copied if is_notice(Path(path)))
        normalized_license = declared_license.lower()
        if not notice_files and normalized_license not in NOTICE_OPTIONAL_LICENSES:
            raise RuntimeError(
                f"Conda package has no retained notice file: {package.name} ({declared_license})"
            )
        packages.append(
            {
                "package": package.name,
                "name": index.get("name"),
                "version": index.get("version"),
                "build": index.get("build"),
                "license": declared_license,
                "files": sorted(copied),
                "notice_files": notice_files,
                "disposition": "embedded-notice" if notice_files else "public-domain-notice-optional",
            }
        )

    if not packages:
        raise RuntimeError("No Conda packages were collected")
    manifest: dict[str, object] = {
        "schema": "conda-notice-bundle/1.0",
        "source": str(cache),
        "packages": packages,
    }
    (bundle / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", type=Path, default=Path("/opt/conda/pkgs"))
    parser.add_argument(
        "--bundle",
        type=Path,
        default=Path("/opt/conda/share/mcp-chrono/conda-notices"),
    )
    args = parser.parse_args()
    collect(args.cache, args.bundle)


if __name__ == "__main__":
    main()

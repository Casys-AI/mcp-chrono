#!/usr/bin/env python3
"""Fail closed when the final runtime image loses a required notice boundary."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path


STATIC_NOTICES = (
    "README.md",
    "CASYS_MCP_SERVER.txt",
    "DENO.md",
    "DENO_STD_YAML.txt",
    "MAMBA.txt",
    "MICROMAMBA_DOCKER_NOTICE.txt",
    "PROJECT_CHRONO.txt",
    "SQLITE_BLESSING.txt",
    "SOURCE_AVAILABILITY.md",
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def verify() -> None:
    static_root = Path("/usr/share/licenses/mcp-chrono")
    for name in STATIC_NOTICES:
        require((static_root / name).is_file(), f"Missing static runtime notice: {name}")
    require(Path("/usr/share/common-licenses/Apache-2.0").is_file(), "Missing Apache-2.0 text")
    require(Path("/app/LICENSE").is_file(), "Missing MCP source licence")
    require(Path("/app/THIRD_PARTY_NOTICES.md").is_file(), "Missing third-party notice index")

    bundle = Path("/opt/conda/share/mcp-chrono/conda-notices")
    manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
    require(manifest.get("schema") == "conda-notice-bundle/1.0", "Wrong Conda notice schema")
    entries = manifest.get("packages")
    require(isinstance(entries, list) and bool(entries), "Empty Conda notice manifest")
    manifest_packages = {entry["package"] for entry in entries}
    metadata_packages = {path.stem for path in Path("/opt/conda/conda-meta").glob("*.json")}
    require(manifest_packages == metadata_packages, "Conda notice manifest does not cover installed metadata")
    for entry in entries:
        require(bool(entry.get("license")), f"Missing declared licence: {entry['package']}")
        files = entry.get("files")
        require(isinstance(files, list) and bool(files), f"Missing retained metadata: {entry['package']}")
        for relative in files:
            require((bundle / relative).is_file(), f"Missing retained Conda file: {relative}")
        require(
            bool(entry.get("notice_files")) or entry.get("disposition") == "public-domain-notice-optional",
            f"Missing notice disposition: {entry['package']}",
        )
    require(not Path("/opt/conda/pkgs").exists(), "Conda package cache was not removed")

    dpkg_output = subprocess.run(
        ["dpkg-query", "-W", "-f=${binary:Package}\\n"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    for package in filter(None, dpkg_output.splitlines()):
        package_name = package.split(":", 1)[0]
        require(
            (Path("/usr/share/doc") / package_name / "copyright").is_file(),
            f"Missing Ubuntu copyright file: {package}",
        )

    npm_root = Path("/opt/deno/npm/registry.npmjs.org")
    package_json_files = list(npm_root.glob("*/*/package.json")) + list(
        npm_root.glob("@*/*/*/package.json")
    )
    require(bool(package_json_files), "No cached npm package inventory")
    for package_json in package_json_files:
        metadata = json.loads(package_json.read_text(encoding="utf-8"))
        require(bool(metadata.get("license") or metadata.get("licenses")), f"Missing npm licence: {package_json}")
        notices = [
            path
            for path in package_json.parent.iterdir()
            if path.is_file()
            and path.name.lower().startswith(("license", "licence", "copying", "notice", "copyright"))
        ]
        require(bool(notices), f"Missing npm notice file: {package_json.parent}")


if __name__ == "__main__":
    verify()

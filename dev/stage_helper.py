#!/usr/bin/env python3
"""Stage what the desktop shell bundles (#99), before `tauri build`:

    python3 dev/stage_helper.py [--triple x86_64-pc-windows-msvc]

- helper/src-tauri/resources/companion/  the pipeline as it runs: package.json, src/, the
  built window ui/ (from `npm run build:video` in frontend/), and node_modules from
  `npm ci --omit=dev` (pure JavaScript, so built here and run there);
- helper/src-tauri/binaries/node-<triple>[.exe]  the pinned Node release for the target,
  named the way Tauri wants an external binary (fetched from nodejs.org, SHA-256 checked;
  the same pin as the console zip, dev/package_companion.py).
"""
import argparse
import os
import shutil
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from package_companion import NODE_VERSION, fetch_node  # noqa: E402

COMPANION = os.path.join(ROOT, "companion")
TAURI = os.path.join(ROOT, "helper", "src-tauri")
SHIP = ["package.json", "package-lock.json", "README.md", "gridfpv-video.example.json"]


def stage_companion() -> str:
    dest = os.path.join(TAURI, "resources", "companion")
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    os.makedirs(dest)
    for name in SHIP:
        shutil.copy(os.path.join(COMPANION, name), dest)
    shutil.copytree(os.path.join(COMPANION, "src"), os.path.join(dest, "src"))
    ui = os.path.join(COMPANION, "ui")
    if not os.path.isfile(os.path.join(ui, "index.html")):
        sys.exit("companion/ui is not built: run `npm run build:video` in frontend/ first")
    shutil.copytree(ui, os.path.join(dest, "ui"))
    npm = "npm.cmd" if os.name == "nt" else "npm"
    subprocess.run(
        [npm, "ci", "--omit=dev", "--no-fund", "--no-audit", "--ignore-scripts"], cwd=dest, check=True
    )
    # The lockfile did its job; the bundle does not need it.
    os.remove(os.path.join(dest, "package-lock.json"))
    return dest


def stage_node(triple: str) -> str:
    if "windows" not in triple:
        sys.exit(f"only Windows targets are staged for now (got {triple}); see #99")
    node_zip = fetch_node(os.path.join(COMPANION, ".cache"))
    out_dir = os.path.join(TAURI, "binaries")
    os.makedirs(out_dir, exist_ok=True)
    target = os.path.join(out_dir, f"node-{triple}.exe")
    with zipfile.ZipFile(node_zip) as z:
        for info in z.infolist():
            if os.path.basename(info.filename) == "node.exe" and info.filename.count("/") == 1:
                with z.open(info) as src, open(target, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                break
        else:
            sys.exit("node.exe not found in the Node zip")
    return target


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--triple", default="x86_64-pc-windows-msvc", help="the Rust target triple Tauri builds for")
    args = ap.parse_args()
    c = stage_companion()
    n = stage_node(args.triple)
    print(f"staged {c}")
    print(f"staged {n} (node {NODE_VERSION})")


if __name__ == "__main__":
    main()

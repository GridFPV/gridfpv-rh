#!/usr/bin/env python3
"""Package the video companion for Windows as a zip that carries its dependencies (#96).

    python3 dev/package_companion.py companion dist/gridfpv-video-win64.zip

Inside, `gridfpv-video/` holds node.exe (the pinned Node release for win-x64, fetched from
nodejs.org and verified against its published SHA-256, cached under companion/.cache),
node_modules/ from `npm ci --omit=dev` (all pure JavaScript, so built here and run there),
src/, the launcher gridfpv-video.cmd, the README and the example config. ffmpeg is not
inside — its Windows build is 115 MB — the launcher fetches it once on first run.
"""
import hashlib
import io
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

NODE_VERSION = "v22.23.4"
NODE_SHA256 = "cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20"
NODE_URL = f"https://nodejs.org/dist/{NODE_VERSION}/node-{NODE_VERSION}-win-x64.zip"

SHIP = ["package.json", "package-lock.json", "README.md", "gridfpv-video.cmd", "gridfpv-video.example.json"]


def fetch_node(cache: str) -> str:
    os.makedirs(cache, exist_ok=True)
    path = os.path.join(cache, os.path.basename(NODE_URL))
    if not os.path.isfile(path) or sha256(path) != NODE_SHA256:
        print(f"fetching {NODE_URL}")
        with urllib.request.urlopen(NODE_URL, timeout=120) as r, open(path + ".part", "wb") as f:
            shutil.copyfileobj(r, f)
        os.replace(path + ".part", path)
        got = sha256(path)
        if got != NODE_SHA256:
            os.remove(path)
            sys.exit(f"node zip checksum {got} != {NODE_SHA256}")
    return path


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main(companion: str, out: str) -> None:
    node_zip = fetch_node(os.path.join(companion, ".cache"))
    stage = tempfile.mkdtemp(prefix="gridfpv-video-")
    try:
        root = os.path.join(stage, "gridfpv-video")
        os.makedirs(root)
        for name in SHIP:
            shutil.copy(os.path.join(companion, name), root)
        shutil.copytree(os.path.join(companion, "src"), os.path.join(root, "src"))
        # The helper's window (#99), if built: `gridfpv-video.cmd ui` serves it in the browser.
        ui = os.path.join(companion, "ui")
        if os.path.isfile(os.path.join(ui, "index.html")):
            shutil.copytree(ui, os.path.join(root, "ui"))
        subprocess.run(["npm", "ci", "--omit=dev", "--no-fund", "--no-audit", "--ignore-scripts"], cwd=root, check=True)
        with zipfile.ZipFile(node_zip) as z:
            for info in z.infolist():
                base = os.path.basename(info.filename)
                if base in ("node.exe", "LICENSE") and info.filename.count("/") == 1:
                    target = os.path.join(root, "node.exe" if base == "node.exe" else "LICENSE-node.txt")
                    with z.open(info) as src, open(target, "wb") as dst:
                        shutil.copyfileobj(src, dst)
        if not os.path.isfile(os.path.join(root, "node.exe")):
            sys.exit("node.exe not found in the Node zip")
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        tmp = out + ".part"
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            for dirpath, dirnames, filenames in os.walk(stage):
                dirnames.sort()
                for fn in sorted(filenames):
                    full = os.path.join(dirpath, fn)
                    z.write(full, os.path.relpath(full, stage))
        os.replace(tmp, out)
        print(f"packaged {out}: {os.path.getsize(out) / 1e6:.1f} MB (node {NODE_VERSION})")
    finally:
        shutil.rmtree(stage, ignore_errors=True)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])

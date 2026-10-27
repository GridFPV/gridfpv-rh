#!/usr/bin/env python3
"""The built SPA must load nothing from the network (#41): fail on any external URL in
plugin/gridfpv/static that is not a known harmless string (XML namespaces, Svelte's
error-explainer links, which are never fetched)."""
import re
import sys
from pathlib import Path

# Strings libraries carry for their error messages; nothing is ever fetched from them.
ALLOW = ("http://www.w3.org/", "https://svelte.dev/e/", "https://svelte.dev/docs", "https://socket.io/docs/")
URL = re.compile(rb"""https?://[^\s"'`)<>]+""")


def main(static: Path) -> int:
    bad = []
    for f in sorted(static.rglob("*")):
        if f.suffix not in (".html", ".js", ".css", ".json", ".svg"):
            continue
        for m in URL.finditer(f.read_bytes()):
            url = m.group(0).decode("utf-8", "replace")
            if not url.startswith(ALLOW):
                bad.append((f.relative_to(static), url))
    for f, url in bad:
        print(f"external URL in {f}: {url}")
    print(f"{'FAIL' if bad else 'OK'}: {len(bad)} external URL(s) in {static}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1] if len(sys.argv) > 1 else "plugin/gridfpv/static")))

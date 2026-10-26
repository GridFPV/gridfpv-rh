#!/usr/bin/env python3
"""List every control on RotorHazard's admin pages, and check the coverage map (T1, #32).

The rule (#28): anything RotorHazard's UI can set, Grid can set or links to. This script
is how the rule is enforced. It scrapes RotorHazard's page templates at the pinned version
for every <input>, <select>, <textarea> and <button> with an id, and compares them with
rh-coverage.tsv, where each control carries a status:

    ours          settable in Grid
    link          Grid shows a "Set in RotorHazard" link to that page
    rh-only       left to RotorHazard on purpose (say why in the note)
    planned:T<n>  not yet; the tier that will do it

Usage:
    rh_controls.py scrape <rh-src-dir>            print page<TAB>id<TAB>kind<TAB>label
    rh_controls.py check  <rh-src-dir> <map.tsv>  exit 1 on any control the map lacks

Controls RotorHazard builds per entity in JavaScript (a callsign input per pilot, a name
input per heat) have no literal id in the template and are not listed; they belong to the
entity screens (Pilots, Stages, Formats), which the e2e scenarios cover.
"""
from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

PAGES = ["settings", "advanced-settings", "format", "run", "marshal", "event", "results", "streams"]
STATUSES = re.compile(r"^(ours|link|rh-only|planned:T[1-8])$")

TAG = re.compile(r"<(input|select|textarea|button)\b([^>]*)>", re.I | re.S)
ATTR_ID = re.compile(r"""\bid\s*=\s*["']([^"']+)["']""")
ATTR_TYPE = re.compile(r"""\btype\s*=\s*["']([^"']+)["']""")
LABEL_FOR = re.compile(r"""<label[^>]*\bfor\s*=\s*["']([^"']+)["'][^>]*>(.*?)</label>""", re.I | re.S)
JINJA_TEXT = re.compile(r"""__\(\s*['"](.*?)['"]\s*\)""")
JINJA_ANY = re.compile(r"{{.*?}}|{%.*?%}", re.S)
HTML_TAG = re.compile(r"<[^>]+>")


def clean_label(raw: str) -> str:
    texts = JINJA_TEXT.findall(raw)
    if texts:
        return " ".join(t.strip() for t in texts)
    s = JINJA_ANY.sub("", raw)
    s = HTML_TAG.sub("", s)
    return " ".join(s.split())


def scrape(rh_src: Path) -> list[tuple[str, str, str, str]]:
    templates = rh_src / "src" / "server" / "templates"
    rows: list[tuple[str, str, str, str]] = []
    for page in PAGES:
        html = (templates / f"{page}.html").read_text(encoding="utf-8", errors="replace")
        labels = {m.group(1): clean_label(m.group(2)) for m in LABEL_FOR.finditer(html)}
        seen: set[str] = set()
        for m in TAG.finditer(html):
            tag, attrs = m.group(1).lower(), m.group(2)
            idm = ATTR_ID.search(attrs)
            if not idm:
                continue
            cid = idm.group(1)
            if "{{" in cid or cid in seen:
                continue  # templated ids are per-entity rows
            seen.add(cid)
            kind = tag
            if tag == "input":
                tm = ATTR_TYPE.search(attrs)
                kind = f"input:{tm.group(1).lower() if tm else 'text'}"
            if kind == "input:hidden":
                continue
            rows.append((page, cid, kind, labels.get(cid, "")))
    return rows


def read_map(path: Path) -> dict[tuple[str, str], dict[str, str]]:
    out: dict[tuple[str, str], dict[str, str]] = {}
    with path.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            out[(row["page"], row["id"])] = row
    return out


def check(rh_src: Path, map_path: Path) -> int:
    scraped = scrape(rh_src)
    mapped = read_map(map_path)
    bad = 0
    for key, row in mapped.items():
        if not STATUSES.match(row.get("status", "")):
            print(f"bad status for {key[0]}#{key[1]}: {row.get('status')!r}")
            bad += 1
    missing = [r for r in scraped if (r[0], r[1]) not in mapped]
    for page, cid, kind, label in missing:
        print(f"unclassified: {page}#{cid} ({kind}) {label}")
    stale = [k for k in mapped if k not in {(r[0], r[1]) for r in scraped}]
    for page, cid in stale:
        print(f"stale (not in RotorHazard any more): {page}#{cid}")
    counts: dict[str, int] = {}
    for key in mapped:
        st = mapped[key]["status"]
        counts[st] = counts.get(st, 0) + 1
    print(f"{len(scraped)} controls in RotorHazard, {len(mapped)} in the map; " +
          ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))
    if missing or bad:
        print(f"FAIL: {len(missing)} unclassified, {bad} bad status")
        return 1
    print("OK: every RotorHazard control is classified")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) >= 3 and argv[1] == "scrape":
        print("page\tid\tkind\tlabel")
        for row in scrape(Path(argv[2])):
            print("\t".join(row))
        return 0
    if len(argv) >= 4 and argv[1] == "check":
        return check(Path(argv[2]), Path(argv[3]))
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))

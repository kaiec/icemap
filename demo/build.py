#!/usr/bin/env python3
"""Build the demo site (GitHub Pages, docs/) from the inputs that demo/mesh.py and demo/stw.py wrote.

    python3 demo/mesh.py --work WORK && python3 demo/stw.py --work WORK
    python3 demo/build.py --work WORK [--out docs]

Runs icemap.py for each hierarchy (into <out>/<name>/), copies icemap.js and the page files, and fills the numbers
of the annotation sets into the page (placeholders {{name.set.documents}} and the like).
"""

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = Path(__file__).resolve().parent / "site"
MAPS = {
    "mesh": ("Medical Subject Headings (MeSH)", ["manual", "automated-2021", "automated", "curated"]),
    "stw": ("STW Thesaurus for Economics", ["econis-2008", "econis-2023"]),
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()[:10]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--work", required=True, type=Path)
    ap.add_argument("--out", type=Path, default=ROOT / "docs")
    args = ap.parse_args()
    out = args.out
    out.mkdir(parents=True, exist_ok=True)

    facts = {}
    for name, (title, sets) in MAPS.items():
        src = args.work / name
        meta = json.loads((src / "sets.json").read_text(encoding="utf-8"))
        cmd = [sys.executable, str(ROOT / "icemap.py"), "--concepts", str(src / "concepts.tsv"),
               "--out", str(out / name), "--title", title]
        for s in sets:
            cmd += ["--set", s, meta[s]["label"], str(src / f"{s}.tsv")]
        subprocess.run(cmd, check=True)
        manifest = json.loads((out / name / "manifest.json").read_text(encoding="utf-8"))
        facts[f"{name}.nodes"] = manifest["nodes"]
        for s in manifest["sets"]:
            for k in ("documents", "annotations"):
                facts[f"{name}.{s['id']}.{k}"] = s[k]
            facts[f"{name}.{s['id']}.per"] = f"{s['annotations'] / s['documents']:.1f}"
        for s, m in meta.items():
            if "fetched" in m:
                facts[f"{name}.{s}.fetched"] = m["fetched"]

    shutil.copy(ROOT / "web" / "icemap.js", out / "icemap.js")
    for f in ("demo.js", "demo.css"):
        shutil.copy(SITE / f, out / f)
    facts["v.css"], facts["v.js"] = digest(out / "demo.css"), digest(out / "demo.js")
    page = (SITE / "index.html").read_text(encoding="utf-8")

    def fill(m):
        v = facts[m.group(1)]
        return f"{v:,}" if isinstance(v, int) else str(v)
    (out / "index.html").write_text(re.sub(r"\{\{([\w.-]+)\}\}", fill, page), encoding="utf-8")
    (out / ".nojekyll").write_text("")
    print(f"written to {out}")


if __name__ == "__main__":
    main()

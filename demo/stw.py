#!/usr/bin/env python3
"""STW and EconBiz for the demo: the thesaurus hierarchy and samples of the subject indexing of ECONIS.

    python3 demo/stw.py --work WORK

Hierarchy: the STW Thesaurus for Economics (current version, N-Triples, ZBW), without deprecated concepts. The
thesaurus categories (skos:broader between categories) are the upper levels, the descriptors below them. The
primary parent of a descriptor is a broader descriptor that shares one of its categories, else its first category;
all other broader concepts are further parents. Labels are the English preferred labels.

Annotation sets: records of ECONIS, the catalogue of the ZBW, from the EconBiz API, for two periods of publication:
pages of 1,000 records at evenly spaced offsets of the result list. The subjects of a record (labels, German and
English, mixed with free keywords) are matched to STW descriptors by their preferred and alternative labels,
ignoring case; labels of several descriptors are not used.

Writes WORK/stw/concepts.tsv and WORK/stw/<set>.tsv. Downloads are cached in WORK/src.
"""

import argparse
import io
import json
import re
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

UA = "icemap-demo (https://github.com/kaiec/icemap)"
STW_URL = "https://zbw.eu/stw/version/latest/download/stw.nt.zip"
API = "https://api.econbiz.de/v1/search"
SKOS = "http://www.w3.org/2004/02/skos/core#"
SETS = {   # id -> (label, first year, last year)
    "econis-2008": ("ECONIS, published 2008–2010", 2008, 2010),
    "econis-2023": ("ECONIS, published 2023–2025", 2023, 2025),
}
PAGES, PAGE_SIZE = 20, 1000
TRIPLE = re.compile(r'^<([^>]*)> <([^>]*)> (?:<([^>]*)>|"((?:[^"\\]|\\.)*)"(?:@([\w-]+)|\^\^<[^>]*>)?) \.$')


def get(url, tries=5):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=120) as r:
                return r.read()
        except Exception as e:
            if k == tries - 1:
                raise
            print(f"  retry ({e})")
            time.sleep(3 * (k + 1))


def unescape(s):
    return json.loads(f'"{s}"') if "\\" in s else s


def read_stw(path):
    types, broader, deprecated, labels, pref = {}, {}, set(), {}, {}
    with zipfile.ZipFile(path) as z, z.open("stw.nt") as f:
        for line in io.TextIOWrapper(f, encoding="utf-8"):
            m = TRIPLE.match(line.rstrip("\n"))
            if not m:
                continue
            s, p, iri, lit, lang = m.groups()
            if p.endswith("#type") and iri:
                types.setdefault(s, set()).add(iri.rsplit("/", 1)[-1])
            elif p == SKOS + "broader":
                broader.setdefault(s, []).append(iri)
            elif p.endswith("#deprecated"):
                deprecated.add(s)
            elif p in (SKOS + "prefLabel", SKOS + "altLabel", SKOS + "hiddenLabel") and lit is not None:
                text = " ".join(unescape(lit).split())
                labels.setdefault(s, set()).add(text)
                if p == SKOS + "prefLabel" and lang == "en":
                    pref[s] = text
    return types, broader, deprecated, labels, pref


def short(iri):
    return iri.rsplit("/stw/", 1)[-1]          # descriptor/12345-6, thsys/71234


def hierarchy(types, broader, deprecated, pref):
    live = {s for s, t in types.items() if ("Descriptor" in t or "Thsys" in t) and s not in deprecated}
    cats = {s for s in live if "Thsys" in types[s]}
    rows = []
    for s in sorted(cats, key=lambda c: pref.get(c, c)):
        rows.append((short(s), pref.get(s, short(s)), [short(b) for b in broader.get(s, []) if b in cats]))
    for s in sorted(live - cats, key=lambda d: pref.get(d, d)):
        bs = [b for b in broader.get(s, []) if b in live]
        own = [b for b in bs if b in cats]
        nested = [b for b in bs if b not in cats and set(broader.get(b, [])) & set(own)]
        first = nested[:1] or own[:1] or bs[:1]
        parents = first + [b for b in bs if b not in first]
        rows.append((short(s), pref.get(s, short(s)), [short(b) for b in parents]))
    return rows


def label_index(types, deprecated, labels):
    index = {}
    for s, ls in labels.items():
        if "Descriptor" in types.get(s, ()) and s not in deprecated:
            for label in ls:
                index.setdefault(label.casefold(), set()).add(short(s))
    return {k: next(iter(v)) for k, v in index.items() if len(v) == 1}


def sample(first, last, cache):
    """Records of ECONIS published in [first, last]: PAGES pages at evenly spaced offsets; cached as JSON lines."""
    if cache.exists():
        return [json.loads(line) for line in cache.read_text().splitlines()]
    q = f"source:econis AND date_sort:[{first} TO {last}]"
    total = json.loads(get(API + "?" + urllib.parse.urlencode({"q": q, "size": 0})))["hits"]["total"]
    out = []
    for k in range(PAGES):
        start = 1 + k * (total - PAGE_SIZE) // (PAGES - 1)
        r = json.loads(get(API + "?" + urllib.parse.urlencode({"q": q, "size": PAGE_SIZE, "from": start})))
        out += [[h["id"], h.get("subject", [])] for h in r["hits"]["hits"]]
        time.sleep(1)
    print(f"  {first}-{last}: {total} records, {len(out)} fetched")
    tmp = cache.with_suffix(".tmp")
    tmp.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in out))
    tmp.rename(cache)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--work", required=True, type=Path)
    args = ap.parse_args()
    src, out = args.work / "src", args.work / "stw"
    out.mkdir(parents=True, exist_ok=True)
    path = src / "stw.nt.zip"
    if not path.exists():
        path.write_bytes(get(STW_URL))

    types, broader, deprecated, labels, pref = read_stw(path)
    rows = hierarchy(types, broader, deprecated, pref)
    with open(out / "concepts.tsv", "w", encoding="utf-8") as f:
        f.writelines(f"{cid}\t{label}\t{' '.join(parents)}\n" for cid, label, parents in rows)
    print(f"stw: {len(rows)} concepts")

    index = label_index(types, deprecated, labels)
    meta = {}
    for sid, (label, first, last) in SETS.items():
        records = sample(first, last, src / f"econis-{first}-{last}.jsonl")
        docs = anns = 0
        with open(out / f"{sid}.tsv", "w", encoding="utf-8") as f:
            for rid, subjects in records:
                ds = list(dict.fromkeys(index[s.casefold()] for s in subjects if s.casefold() in index))
                if ds:
                    docs += 1
                    anns += len(ds)
                    f.writelines(f"{rid}\t{d}\n" for d in ds)
        meta[sid] = {"label": label, "documents": docs, "annotations": anns, "fetched": len(records)}
        print(f"  {sid}: {docs} of {len(records)} records with STW descriptors, {anns} descriptors")
    (out / "sets.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()

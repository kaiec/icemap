#!/usr/bin/env python3
"""MeSH and MEDLINE for the demo: the descriptor hierarchy and samples of MEDLINE indexing.

    python3 demo/mesh.py --work WORK

Hierarchy: the MeSH descriptors of the current year (desc<year>.gz of NLM), nested by their tree numbers; the
first tree number gives the primary parent, the others are further parents. The tree categories (A Anatomy, ...)
are the top level.

Annotation sets: MEDLINE citations sampled by the date they entered PubMed ([edat]), a fixed number per day of a
year, fetched with the NCBI E-utilities. Each citation counts with its MeSH descriptors (qualifiers ignored), split
by the IndexingMethod NLM records for it: "Manual" (indexed by people) and "Automated" among the citations of 2021,
the last year before NLM indexed all of MEDLINE automatically (April 2022); "Automated" and "Curated" (automated,
then reviewed by people) among those of 2025.

Writes WORK/mesh/concepts.tsv and WORK/mesh/<set>.tsv. Downloads are cached in WORK/src.
"""

import argparse
import datetime
import gzip
import json
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

UA = "icemap-demo (https://github.com/kaiec/icemap)"
MESH_URL = "https://nlmpubs.nlm.nih.gov/projects/mesh/MESH_FILES/xmlmesh/desc{year}.gz"
EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"
CATEGORIES = {
    "A": "Anatomy", "B": "Organisms", "C": "Diseases", "D": "Chemicals and Drugs",
    "E": "Analytical, Diagnostic and Therapeutic Techniques, and Equipment", "F": "Psychiatry and Psychology",
    "G": "Phenomena and Processes", "H": "Disciplines and Occupations",
    "I": "Anthropology, Education, Sociology, and Social Phenomena", "J": "Technology, Industry, and Agriculture",
    "K": "Humanities", "L": "Information Science", "M": "Named Groups", "N": "Health Care",
    "V": "Publication Characteristics", "Z": "Geographicals",
}
# sets: id -> (label, year the citations entered PubMed, IndexingMethod)
SETS = {
    "manual": ("MEDLINE 2021, indexed by people", 2021, "Manual"),
    "automated-2021": ("MEDLINE 2021, automated indexing", 2021, "Automated"),
    "automated": ("MEDLINE 2025, automated indexing", 2025, "Automated"),
    "curated": ("MEDLINE 2025, automated indexing reviewed by people", 2025, "Curated"),
}
PER_DAY = {2021: 150, 2025: 80}     # about a third of 2021 is "Manual"; in 2025 two thirds "Automated"


def get(url, data=None, tries=5):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception as e:  # network errors and 429: wait and try again
            if k == tries - 1:
                raise
            print(f"  retry ({e})", flush=True)
            time.sleep(3 * (k + 1))


def download(url, path):
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.with_suffix(".tmp").write_bytes(get(url))
        path.with_suffix(".tmp").rename(path)
    return path


def hierarchy(desc_gz):
    """(id, label, parents) for the categories and descriptors; parents by tree number, first one primary."""
    descriptors, by_tree = [], {}
    with gzip.open(desc_gz) as f:
        for _, el in ET.iterparse(f):
            if el.tag != "DescriptorRecord":
                continue
            ui = el.findtext("DescriptorUI")
            name = el.findtext("DescriptorName/String")
            trees = [t.text for t in el.findall("TreeNumberList/TreeNumber")]
            descriptors.append((ui, name, trees))
            for t in trees:
                by_tree[t] = ui
            el.clear()
    rows = [(f"cat:{c}", f"{label} [{c}]", []) for c, label in CATEGORIES.items()]
    rows.append(("cat:none", "Without tree number (Female, Male)", []))
    for ui, name, trees in descriptors:
        parents = []
        for t in trees:
            p = by_tree.get(t.rsplit(".", 1)[0]) if "." in t else f"cat:{t[0]}"
            if p and p != ui and p not in parents:
                parents.append(p)
        rows.append((ui, name, parents or ["cat:none"]))
    return rows


def esearch(term, retmax):
    q = urllib.parse.urlencode({"db": "pubmed", "term": term, "retmax": retmax, "retmode": "json",
                                "tool": "icemap-demo"})
    for k in range(5):
        r = json.loads(get(EUTILS + "esearch.fcgi?" + q))
        if "idlist" in r.get("esearchresult", {}):
            return r["esearchresult"]["idlist"]
        print(f"  retry ({r})")     # e.g. the rate limit, answered as JSON
        time.sleep(3 * (k + 1))
    raise RuntimeError(f"esearch failed: {term}")


def efetch(ids, tries=5):
    """(pmid, IndexingMethod or None, [descriptor UIs]) per citation."""
    data = urllib.parse.urlencode({"db": "pubmed", "id": ",".join(ids), "retmode": "xml",
                                   "tool": "icemap-demo"}).encode()
    for k in range(tries):
        try:
            root = ET.fromstring(get(EUTILS + "efetch.fcgi", data))
            break
        except ET.ParseError as e:  # a response cut off
            if k == tries - 1:
                raise
            print(f"  retry ({e})")
            time.sleep(3 * (k + 1))
    out = []
    for mc in root.iter("MedlineCitation"):
        uis = [d.get("UI") for d in mc.findall("MeshHeadingList/MeshHeading/DescriptorName")]
        out.append([mc.findtext("PMID"), mc.get("IndexingMethod"), uis])
    return out


def sample(year, per_day, cache):
    """Citations that entered PubMed in the given year, per_day of each day; cached as JSON lines.

    The ids (cache.ids) and the fetched citations (cache.part) are kept as they come, so a broken run resumes."""
    if cache.exists():
        return [json.loads(line) for line in cache.read_text().splitlines()]
    id_file, part = cache.with_suffix(".ids"), cache.with_suffix(".part")
    if id_file.exists():
        ids = id_file.read_text().split()
    else:
        ids, day = [], datetime.date(year, 1, 1)
        while day.year == year:
            ids += esearch(f"medline[sb] AND {day:%Y/%m/%d}[edat]", per_day)
            time.sleep(0.4)
            day += datetime.timedelta(days=1)
        ids = list(dict.fromkeys(ids))
        id_file.write_text("\n".join(ids) + "\n")
    print(f"  {year}: {len(ids)} citations", flush=True)
    done = {json.loads(line)[0] for line in part.read_text().splitlines()} if part.exists() else set()
    todo = [i for i in ids if i not in done]
    with open(part, "a") as f:
        for k in range(0, len(todo), 300):
            f.writelines(json.dumps(r) + "\n" for r in efetch(todo[k:k + 300]))
            f.flush()
            time.sleep(0.4)
    part.rename(cache)
    id_file.unlink()
    return [json.loads(line) for line in cache.read_text().splitlines()]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--work", required=True, type=Path)
    ap.add_argument("--mesh-year", type=int, default=2026)
    args = ap.parse_args()
    src, out = args.work / "src", args.work / "mesh"
    out.mkdir(parents=True, exist_ok=True)

    desc = download(MESH_URL.format(year=args.mesh_year), src / f"desc{args.mesh_year}.gz")
    rows = hierarchy(desc)
    known = {r[0] for r in rows}
    with open(out / "concepts.tsv", "w", encoding="utf-8") as f:
        f.writelines(f"{cid}\t{label}\t{' '.join(parents)}\n" for cid, label, parents in rows)
    print(f"mesh: {len(rows)} concepts")

    citations = {}
    for year in sorted({y for _, y, _ in SETS.values()}):
        citations[year] = sample(year, PER_DAY[year], src / f"medline-{year}-{PER_DAY[year]}.jsonl")
    meta = {}
    for sid, (label, year, method_wanted) in SETS.items():
        docs = anns = 0
        with open(out / f"{sid}.tsv", "w", encoding="utf-8") as f:
            for pmid, method, uis in citations[year]:
                uis = [u for u in dict.fromkeys(uis) if u in known]
                if method == method_wanted and uis:
                    docs += 1
                    anns += len(uis)
                    f.writelines(f"{pmid}\t{u}\n" for u in uis)
        meta[sid] = {"label": label, "documents": docs, "annotations": anns}
        print(f"  {sid}: {docs} citations, {anns} descriptors")
    (out / "sets.json").write_text(json.dumps(meta, indent=1))


if __name__ == "__main__":
    main()

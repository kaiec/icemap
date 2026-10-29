#!/usr/bin/env python3
"""Build the static files of an ICE-Map from a hierarchy and annotation sets.

    python3 icemap.py --concepts concepts.tsv --set a "Documents of A" a.tsv --out data/

concepts.tsv: id, label, parents (space-separated, the first one primary) per line (decision 0003).
<set>.tsv: document id, concept id per line.
Writes manifest.json, chunks/<i>.json and sets/<set>/<i>.f32 (decision 0004). Python standard library only.
"""

import argparse
import array
import datetime
import json
import shutil
import sys
from pathlib import Path

FORMAT = "icemap/1"


class Hierarchy:
    """A spanning tree of the concepts, numbered in depth-first order (decisions 0002, 0004)."""

    def __init__(self, concepts, title, warn=print):
        # concepts: list of (id, label, [parent ids]) in input order
        self.warnings = []
        pos = {}
        for k, (cid, _, _) in enumerate(concepts):
            if cid in pos:
                raise ValueError(f"concept {cid!r} is listed twice")
            pos[cid] = k
        primary, also = [], []
        for cid, _, parents in concepts:
            known = [p for p in parents if p in pos and p != cid]
            for p in parents:
                if p not in pos:
                    self.warnings.append(f"unknown parent {p!r} of {cid!r}, ignored")
            primary.append(pos[known[0]] if known else -1)
            also.append(known[1:])
        # break cycles of primary parents: walk up from every concept; the edge that closes a cycle is dropped
        state = [0] * len(concepts)  # 0 new, 1 on the current path, 2 done
        for k in range(len(concepts)):
            path, j = [], k
            while j != -1 and state[j] == 0:
                state[j] = 1
                path.append(j)
                j = primary[j]
            if j != -1 and state[j] == 1:
                last = path[-1]
                self.warnings.append(f"cycle: {concepts[last][0]!r} -> {concepts[j][0]!r} dropped")
                also[last] = [concepts[primary[last]][0]] + also[last]
                primary[last] = -1
            for q in path:
                state[q] = 2
        children = [[] for _ in concepts]
        roots = []
        for k, p in enumerate(primary):
            (children[p] if p != -1 else roots).append(k)
        # an artificial root if there are several (Eckert 2012, Table 2.1)
        if len(roots) == 1:
            top, extra = roots[0], None
        else:
            top, extra = None, roots
        self.ids, self.labels, self.size, self.parent, self.also = [], [], [], [], []
        index = {}

        def visit(start_items, parent_index):
            # iterative depth-first numbering; items are concept positions
            stack = [(k, parent_index) for k in reversed(start_items)]
            while stack:
                k, par = stack.pop()
                i = len(self.ids)
                index[k] = i
                cid, label, _ = concepts[k]
                self.ids.append(cid)
                self.labels.append(label)
                self.size.append(1)
                self.parent.append(par)
                self.also.append(also[k])
                stack.extend((c, i) for c in reversed(children[k]))

        if extra is None:
            visit([top], -1)
        else:
            self.ids.append("")
            self.labels.append(title)
            self.size.append(1)
            self.parent.append(-1)
            self.also.append([])
            visit(extra, 0)
        for i in range(len(self.ids) - 1, 0, -1):
            self.size[self.parent[i]] += self.size[i]
        self.depth = [0] * len(self.ids)
        for i in range(1, len(self.ids)):
            self.depth[i] = self.depth[self.parent[i]] + 1
        first = 0 if extra is None else 1
        self.index = {self.ids[i]: i for i in range(first, len(self.ids))}
        for w in self.warnings:
            warn(w)

    def __len__(self):
        return len(self.ids)

    def children(self, i):
        j, end = i + 1, i + self.size[i]
        while j < end:
            yield j
            j += self.size[j]


def read_tsv(path):
    with open(path, encoding="utf-8") as f:
        for n, line in enumerate(f, 1):
            line = line.rstrip("\n").rstrip("\r")
            if not line or line.startswith("#"):
                continue
            yield n, line.split("\t")


def read_concepts(path):
    out = []
    for n, cols in read_tsv(path):
        if len(cols) < 2:
            raise ValueError(f"{path}:{n}: expected id, label and parents")
        parents = cols[2].split() if len(cols) > 2 else []
        out.append((cols[0], cols[1], parents))
    return out


def count_set(h, path, count="documents"):
    """w (direct) and w+ (subtree) per node; documents once per subtree, or annotations summed (decision 0004)."""
    n = len(h)
    w = [0] * n
    unknown = 0
    pairs = set() if count == "annotations" else None
    docs = {}
    weights_seen = False
    for _, cols in read_tsv(path):
        if len(cols) < 2:
            continue
        if len(cols) > 2 and cols[2].strip():
            weights_seen = True
        i = h.index.get(cols[1])
        if i is None:
            unknown += 1
            continue
        if pairs is not None:
            pairs.add((cols[0], i))
        else:
            docs.setdefault(cols[0], set()).add(i)
    if count == "annotations":
        for _, i in pairs:
            w[i] += 1
        wp = list(w)
        for i in range(n - 1, 0, -1):
            wp[h.parent[i]] += wp[i]
        documents = len({d for d, _ in pairs})
        annotations = len(pairs)
    else:
        wp = [0] * n
        stamp = [-1] * n
        annotations = 0
        for k, nodes in enumerate(docs.values()):
            annotations += len(nodes)
            for i in nodes:
                w[i] += 1
                while i != -1 and stamp[i] != k:
                    stamp[i] = k
                    wp[i] += 1
                    i = h.parent[i]
        documents = len(docs)
    return {"w": w, "wp": wp, "documents": documents, "annotations": annotations,
            "unknown": unknown, "weights_ignored": weights_seen}


def chunks(h, depth):
    """(root, nodes, stubs) per chunk: a subtree cut at a fixed depth; one chunk if depth is None."""
    roots = [0]
    while roots:
        r = roots.pop(0)
        limit = None if depth is None else h.depth[r] + depth
        nodes, stubs = [], []
        i, end = r, r + h.size[r]
        while i < end:
            nodes.append(i)
            if limit is not None and h.depth[i] == limit and h.size[i] > 1:
                stubs.append(i)
                roots.append(i)
                i += h.size[i]
            else:
                i += 1
        yield r, nodes, stubs


def write(h, sets, out, title, depth=None, count="documents"):
    out = Path(out)
    for sub in ("chunks", "sets"):
        if (out / sub).exists():
            shutil.rmtree(out / sub)
    (out / "chunks").mkdir(parents=True, exist_ok=True)
    for sid in sets:
        (out / "sets" / sid).mkdir(parents=True, exist_ok=True)
    n_chunks = 0
    for r, nodes, stubs in chunks(h, depth):
        recs = []
        for i in nodes:
            rec = [h.ids[i], h.labels[i], h.size[i]]
            if h.also[i]:
                rec.append(h.also[i])
            recs.append(rec)
        with open(out / "chunks" / f"{r}.json", "w", encoding="utf-8") as f:
            json.dump({"root": r, "stubs": stubs, "nodes": recs}, f, ensure_ascii=False, separators=(",", ":"))
        for sid, s in sets.items():
            a = array.array("f")
            for i in nodes:
                a.append(s["w"][i])
                a.append(s["wp"][i])
            if sys.byteorder != "little":
                a.byteswap()
            with open(out / "sets" / sid / f"{r}.f32", "wb") as f:
                a.tofile(f)
        n_chunks += 1
    manifest = {
        "format": FORMAT,
        "title": title,
        "nodes": len(h),
        "depth": max(h.depth),
        "chunkDepth": depth,
        "chunks": n_chunks,
        "count": count,
        "sets": [{"id": sid, "label": s["label"], "documents": s["documents"], "annotations": s["annotations"]}
                 for sid, s in sets.items()],
        "generated": datetime.date.today().isoformat(),
    }
    with open(out / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    return manifest


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--concepts", required=True, type=Path, help="TSV: id, label, parents")
    ap.add_argument("--set", nargs=3, action="append", default=[], metavar=("ID", "LABEL", "TSV"),
                    help="an annotation set: id, label and a TSV of document id, concept id")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--title", default="All concepts", help="label of the root if there are several")
    ap.add_argument("--chunk-depth", type=int, default=None, help="cut the tree into chunks of this depth")
    ap.add_argument("--count", choices=("documents", "annotations"), default="documents",
                    help="w+ counts every document once per subtree (default) or sums annotations")
    args = ap.parse_args(argv)
    say = lambda m: print(m, file=sys.stderr)
    h = Hierarchy(read_concepts(args.concepts), args.title, warn=lambda m: say("warning: " + m))
    sets = {}
    for sid, label, path in args.set:
        if not sid.replace("-", "").replace("_", "").isalnum() or sid == "iic":
            ap.error(f"set id {sid!r}: letters, digits, - and _ only, and not 'iic'")
        s = count_set(h, path, args.count)
        s["label"] = label
        sets[sid] = s
        say(f"set {sid}: {s['documents']} documents, {s['annotations']} annotations"
            + (f", {s['unknown']} lines with unknown concepts skipped" if s["unknown"] else "")
            + (", weights ignored (not supported yet)" if s["weights_ignored"] else ""))
    m = write(h, sets, args.out, args.title, args.chunk_depth, args.count)
    say(f"{m['nodes']} nodes, depth {m['depth']}, {m['chunks']} chunk(s) in {args.out}")


if __name__ == "__main__":
    main()

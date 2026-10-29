import json
import sys
import tempfile
import unittest
from array import array
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import icemap  # noqa: E402

CONCEPTS = [
    ("A", "Alpha", []),
    ("B", "Beta", ["A"]),
    ("C", "Gamma", ["A"]),
    ("D", "Delta", ["B"]),
    ("E", "Epsilon", ["B", "C"]),  # polyhierarchy: primary B, also C
    ("F", "Phi", ["C"]),
]
DOCS = "d1\tD\nd1\tE\nd2\tF\nd3\tE\nd3\tF\nd4\tZ\n"


def tree(concepts=CONCEPTS):
    return icemap.Hierarchy(concepts, "All", warn=lambda m: None)


class HierarchyTest(unittest.TestCase):
    def test_depth_first_order_and_sizes(self):
        h = tree()
        self.assertEqual(h.ids, ["A", "B", "D", "E", "C", "F"])
        self.assertEqual(h.size, [6, 3, 1, 1, 2, 1])
        self.assertEqual(list(h.children(0)), [1, 4])
        self.assertEqual(h.also[3], ["C"])

    def test_several_roots_get_an_artificial_root(self):
        h = tree([("A", "Alpha", []), ("B", "Beta", [])])
        self.assertEqual(h.ids, ["", "A", "B"])
        self.assertEqual(h.labels[0], "All")
        self.assertEqual(h.index, {"A": 1, "B": 2})

    def test_cycle_is_broken_and_reported(self):
        h = tree([("P", "P", ["Q"]), ("Q", "Q", ["P"]), ("R", "R", ["P"])])
        self.assertEqual(len(h.warnings), 1)
        self.assertEqual(h.ids[0], "Q")
        self.assertEqual(h.size[0], 3)
        self.assertEqual(h.also[0], ["P"])  # the dropped parent is kept as "also under"

    def test_unknown_parent_is_ignored(self):
        h = tree([("A", "Alpha", ["nope"])])
        self.assertEqual(h.ids, ["A"])
        self.assertEqual(len(h.warnings), 1)


class CountTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / "s.tsv"
        self.path.write_text(DOCS)

    def tearDown(self):
        self.dir.cleanup()

    def test_documents_once_per_subtree(self):
        s = icemap.count_set(tree(), self.path)
        # order: A B D E C F
        self.assertEqual(s["w"], [0, 0, 1, 2, 0, 2])
        self.assertEqual(s["wp"], [3, 2, 1, 2, 2, 2])
        self.assertEqual((s["documents"], s["annotations"], s["unknown"]), (3, 5, 1))

    def test_annotations_summed(self):
        s = icemap.count_set(tree(), self.path, "annotations")
        self.assertEqual(s["wp"], [5, 3, 1, 2, 2, 2])


class WriteTest(unittest.TestCase):
    def test_chunks_and_set_files(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "s.tsv"
            p.write_text(DOCS)
            h = tree()
            s = icemap.count_set(h, p)
            s["label"] = "Sample"
            m = icemap.write(h, {"s": s}, Path(d) / "out", "All", depth=1)
            self.assertEqual(m["chunks"], 3)
            c0 = json.loads((Path(d) / "out" / "chunks" / "0.json").read_text())
            self.assertEqual(c0["stubs"], [1, 4])
            self.assertEqual([r[0] for r in c0["nodes"]], ["A", "B", "C"])
            c1 = json.loads((Path(d) / "out" / "chunks" / "1.json").read_text())
            self.assertEqual([r[0] for r in c1["nodes"]], ["B", "D", "E"])
            self.assertEqual(c1["nodes"][2][3], ["C"])
            a = array("f")
            a.frombytes((Path(d) / "out" / "sets" / "s" / "1.f32").read_bytes())
            self.assertEqual(list(a), [0, 2, 1, 1, 2, 2])


if __name__ == "__main__":
    unittest.main()

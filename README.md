# icemap

A web implementation of the ICE-Map Visualization, as introduced by Eckert, Stuckenschmidt and Pfeffer (2007) and
described comprehensively by Eckert (2012, chapter 2).

The ICE-Map Visualization depicts a concept hierarchy, such as a thesaurus, a classification or any other knowledge
organization system (KOS), as a treemap (Shneiderman, 1992) with the squarified layout of Bruls, Huizing and van
Wijk (2000). The size of an area is determined by the structure alone: the number of concepts in its subtree. The
colour represents the information content (IC) of a concept, computed from a set of annotations (documents indexed
with the concept), or the difference between two ICs (Eckert, 2012, Eqs. 2.4–2.8):

- IC − IIC compares an annotation set with the intrinsic information content (IIC), which is derived from the
  hierarchy alone. It shows where the usage of a concept deviates from what the structure lets one expect.
- IC − IC compares two annotation sets, e.g. automatic against intellectual indexing, or a collection against a
  reference collection.

Negative differences (the concept is used more often than in the reference) are drawn in red, positive ones in blue.
Since the usage of a concept is propagated to its broader concepts, deviations in deep parts of the hierarchy become
visible at higher levels. Applications include the evaluation of automatic indexing, the selection of a KOS for a
document collection and the identification of parts of a KOS that require maintenance (Eckert, 2012, chapters 3
and 4).

The reference implementation of the ICE-Map Visualization was part of Semtinel (Eckert, 2012, chapter 5). This
repository reimplements it for static web sites. It consists of a generator (`icemap.py`, Python 3.11+, standard
library only) and a browser component (`web/icemap.js`, a single ES module without dependencies). No server-side
component is required. The design decisions are documented in [`docs/decisions/`](docs/decisions/).

## Citation

If you use the ICE-Map Visualization or this implementation, please cite:

> Eckert, K. (2012). *Usage-driven Maintenance of Knowledge Organization Systems* (Doctoral dissertation).
> Universität Mannheim. <https://madoc.bib.uni-mannheim.de/31754/>

```bibtex
@phdthesis{Eckert2012,
  author  = {Eckert, Kai},
  title   = {Usage-driven Maintenance of Knowledge Organization Systems},
  school  = {Universit{\"a}t Mannheim},
  address = {Mannheim},
  year    = {2012},
  url     = {https://madoc.bib.uni-mannheim.de/31754/},
  note    = {urn:nbn:de:bsz:180-madoc-317542}
}
```

The ICE-Map Visualization was first presented at the Fourth International Conference on Knowledge Capture
(K-CAP 2007), where the paper received the best paper award:

> Eckert, K., Stuckenschmidt, H., & Pfeffer, M. (2007). Interactive thesaurus assessment for automatic document
> annotation. In *Proceedings of the 4th International Conference on Knowledge Capture (K-CAP 2007)* (pp. 103–110).
> ACM. <https://doi.org/10.1145/1298406.1298426>

## Publications on the ICE-Map Visualization

- Eckert, K., Stuckenschmidt, H., & Pfeffer, M. (2007). Interactive thesaurus assessment for automatic document
  annotation. In *Proceedings of the 4th International Conference on Knowledge Capture (K-CAP 2007)*, Whistler,
  Canada (pp. 103–110). ACM. <https://doi.org/10.1145/1298406.1298426>. Best paper award.
- Eckert, K., Pfeffer, M., & Stuckenschmidt, H. (2008). Assessing thesaurus-based annotations for semantic search
  applications. *International Journal of Metadata, Semantics and Ontologies*, 3(1).
  <https://doi.org/10.1504/IJMSO.2008.021205>
- Eckert, K., Stuckenschmidt, H., & Pfeffer, M. (2008). Semtinel: Interactive supervision of automatic indexing.
  In *Proceedings of the 8th ACM/IEEE-CS Joint Conference on Digital Libraries (JCDL 2008)* (p. 425). ACM.
  <https://doi.org/10.1145/1378889.1378972>
- Pfeffer, M., Eckert, K., & Stuckenschmidt, H. (2008). Visual analysis of classification systems and library
  collections. In *Research and Advanced Technology for Digital Libraries (ECDL 2008)*, Aarhus, Denmark
  (pp. 436–439). Springer. <https://doi.org/10.1007/978-3-540-87599-4_57>
- Eckert, K., Hänger, C., & Niemann, C. (2009). Tagging and automation: Challenges and chances for academic
  libraries. *Library Hi Tech*, 27(4), 557–569. <https://doi.org/10.1108/07378830911007664>
- Eckert, K. (2011). *The ICE-Map Visualization* (Technical Report TR-2011-003). University of Mannheim, Department
  of Computer Science. <https://madoc.bib.uni-mannheim.de/29611/>
- Eckert, K., Meusel, R., & Stuckenschmidt, H. (2011). User-centered maintenance of concept hierarchies. In
  W. Wong, W. Liu, & M. Bennamoun (Eds.), *Ontology Learning and Knowledge Discovery Using the Web: Challenges and
  Recent Advances* (pp. 105–128). IGI Global. <https://doi.org/10.4018/978-1-60960-625-1.ch006>
- Eckert, K. (2012). *Usage-driven Maintenance of Knowledge Organization Systems* (Doctoral dissertation).
  Universität Mannheim. <https://madoc.bib.uni-mannheim.de/31754/>
- Eckert, K., Ritze, D., & Pfeffer, M. (2012). Does it fit? KOS evaluation using the ICE-Map visualization. In
  *The Semantic Web: ESWC 2012 Satellite Events*, Heraklion, Greece (pp. 408–412). Springer, 2015.
  <https://doi.org/10.1007/978-3-662-46641-4_36>

## Usage

### 1. Generate the files

The generator reads two kinds of input as TSV:

```
concepts.tsv   id <TAB> label <TAB> parent ids, space-separated, the first one primary
<set>.tsv      document id <TAB> concept id          (one file per annotation set)
```

```sh
python3 icemap.py --concepts concepts.tsv \
    --set a "Documents of A" a.tsv --set b "Documents of B" b.tsv --out data/
```

A polyhierarchy is reduced to a spanning tree along the primary parents; the further parents are kept and shown.
Several roots receive an artificial common root (`--title`); cycles are broken and reported. By default, a document
counts once per subtree, however many of its annotations lie below; `--count annotations` sums the annotations
instead. `--chunk-depth N` splits large hierarchies into chunks that are loaded on demand.

### 2. Show them

```html
<div id="map"></div>
<script type="module">
  import { IceMap } from './icemap.js';
  const map = await IceMap.open(document.getElementById('map'), {
    src: 'data/',                    // the directory with manifest.json
    colour: { a: 'a', b: 'iic' },    // IC(a) − IIC; { a: 'a', b: 'b' } compares two sets; { a: 'iic' } the structure
    link: id => `https://example.org/concept/${id}`,
    onChange: ({ focus, select }) => { /* keep the state, e.g. in the address */ },
  });
  // map.setColour({...}), map.focus(id), map.select(id), map.parentOf(id), map.state()
</script>
```

The component draws the treemap, the path to the shown concept (click to zoom out), the hierarchy as a tree beside
it, the details of the selected concept and the colour controls: contrast narrows the colour range, balance shifts
the neutral point. Double-click zooms in; Escape or Backspace zooms out. Colours and panels are set by CSS custom
properties (`--icemap-hot`, `--icemap-cold`, `--icemap-neutral`, `--icemap-seq`, `--icemap-fg`,
`--icemap-panel`, …).

## Tests

```sh
python3 -m unittest discover -s tests
node --test tests/web.test.mjs
```

The tests include the worked example of Eckert (2012, Fig. 2.2) and the squarified layout example of Bruls et al.
(2000).

## Licence

MIT, see [`LICENSE`](LICENSE). Please cite Eckert (2012) when you use the visualization (see Citation).

## References

- Bruls, M., Huizing, K., & van Wijk, J. J. (2000). Squarified treemaps. In *Data Visualization 2000: Proceedings
  of the Joint Eurographics and IEEE TCVG Symposium on Visualization* (pp. 33–42). Springer.
  <https://doi.org/10.1007/978-3-7091-6783-0_4>
- Shneiderman, B. (1992). Tree visualization with tree-maps: 2-d space-filling approach. *ACM Transactions on
  Graphics*, 11(1), 92–99. <https://doi.org/10.1145/102377.115768>

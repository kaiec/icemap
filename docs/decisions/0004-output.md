# 0004 Output: a tree in depth-first order, cut into chunks, with w and w⁺ per annotation set

Status: accepted · Date: 2026-10-29

## Context

The component must work from static files and stay fast for hierarchies of a few thousand nodes and of a few million
(0001). Two things grow with the hierarchy: the structure with its labels, and the numbers of every annotation set.
The size of an area comes from the structure only (Eckert, 2012, §2.4), and the colour from the numbers.

## Decision

- The nodes are numbered in depth-first order. With `size`, the number of nodes in a node's subtree, the subtree of
  node i is the range i … i + size − 1, and its children are i + 1, then j + size(j) for each next one. `size` is
  also the size metric of the layout (Eq. 2.4 over Eq. 2.3). No child lists are stored.
- Files:
  - `manifest.json`: title, number of nodes, the annotation sets (id, label, documents, annotations), how w⁺ counts.
  - `chunks/<i>.json`: the nodes of the chunk rooted at node i, in depth-first order, each `[id, label, size]` plus
    the ids of its other parents where it has any (0002). A chunk is a subtree cut at a fixed depth; a node at the
    cut whose children are in another chunk is listed in `stubs` and roots the chunk of its own index.
  - `sets/<set>/<i>.f32`: for every node of chunk i, w and w⁺ as little-endian Float32.
- The generator writes one chunk unless asked for a chunk depth.
- **w⁺ counts documents:** every document once per subtree, however many of its concepts lie below. An option counts
  annotations instead (the sum of Eq. 2.4, as in Eckert (2012) and in Semtinel). Weights (Eq. 2.2) are not supported yet.
- IC, IIC and IC differences are not stored; the component computes them (IIC from `size` alone).

## Consequences

The overview of any hierarchy needs only its first chunk. With documents counted, the root's w⁺ is the number of
documents with at least one concept in the hierarchy, and every number in the map reads as "documents". Search covers
the loaded chunks only; a label index for large chunked hierarchies is left for later.

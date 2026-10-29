# 0002 A spanning tree; the polyhierarchy as an option

Status: accepted · Date: 2026-10-29

## Context

A treemap needs a tree, but many hierarchies are polyhierarchies. Among the GND subject headings used as occupations,
2,164 have more than one parent; Wikipedia categories have far more, and cycles. Duplicating subtrees is faithful, but
an overpopulated concept then shows up in several places, and the tree can grow by a large factor. Seeing every
occurrence matters only when the polyhierarchy itself is being worked on.

## Decision

- By default, the generator makes a spanning tree: every concept appears once, under its primary parent.
- The other parents are kept with the node, so the component can show "also under …" in the details.
- A view with duplicated subtrees (every occurrence a node) is an option of the generator. It may come later; the
  component sees a tree either way.

## Consequences

Each concept is one area of the map. Which parent is primary is decided by whoever writes the input (0003).

# 0001 A standalone ICE-Map for static sites

Status: accepted · Date: 2026-10-29

## Context

The ICE-Map Visualization, as introduced by Eckert, Stuckenschmidt and Pfeffer (2007) and described by Eckert
(2012, chapter 2), shows a concept hierarchy as a treemap. The size of each area comes from the structure, and its
colour from the difference of two information contents (IC). The reference implementation was part of Semtinel (Java, NetBeans
platform, 2007–2012), which no longer runs as a tool. A first use is a JudaicaLink showcase, but the visualization
is useful for any hierarchy with documents assigned to its concepts.

## Decision

- A repository of its own, independent of JudaicaLink: no dataset, IRI, host or platform convention of
  JudaicaLink in the code. Users bring their own hierarchy and annotation sets.
- Two parts:
  - a generator (Python, standard library only) that turns a hierarchy and annotation sets into static files;
  - a browser component (one JavaScript ES module, no build step, no dependencies, drawn on a canvas) that shows them.
- Static files only. The component needs no backend, and its transfer and drawing costs grow with what is on
  screen, not with the size of the hierarchy (chunked files, layout only for the visible part).
- The statistics follow Eckert (2012, Eqs. 2.1–2.8), including the normalisation of IC by log(ŵ⁺ + 1). Semtinel's
  factor 1.1 in the normaliser is not carried over.

## Consequences

A showcase uses the ICE-Map by running the generator on its own inputs and loading the component. The layout and
the IC difference are computed in the browser, so any two annotation sets of a hierarchy can be compared without
precomputing pairs.

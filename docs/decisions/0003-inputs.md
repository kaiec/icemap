# 0003 Generator inputs: concepts and annotation sets as TSV

Status: accepted · Date: 2026-10-29

## Context

The generator should know nothing about any vocabulary or format of the data it is used with. SKOS is the common
format for hierarchies, but a SKOS reader in standard-library Python is a project of its own.

## Decision

- `concepts.tsv`: one concept per line, with id, label and parents (space-separated). The first parent listed is
  the primary one (0002). Ids are opaque strings.
- One file per annotation set, `<set>.tsv`: document id, concept id, and an optional weight.
- Several roots get an artificial common root (Eckert, 2012, Table 2.1). A cycle is broken at the first back edge and
  reported.
- No SKOS reader. Converting SKOS or anything else into these files is the user's part.

## Consequences

For JudaicaLink, the showcase writes these files from its own data, including the choice of primary parents.

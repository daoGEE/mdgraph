---
title: Structured Query and Relationships
type: guide
status: active
source_refs:
  - src/query/structured-query.ts
  - src/query/structured-query-executor.ts
  - src/relationships/derive-related.ts
  - src/db/repositories.ts
---

# Structured Query and Relationships

MDGraph provides two experimental, explicit workflows beyond natural-language retrieval: a bounded structured query language for documentation governance and a provider-gated process for deriving non-authoritative `RELATED_TO` edges. Neither workflow changes stable `search` behavior or adds an MCP tool.

## Structured Query

Use `query` when the request is a filter or audit rather than a relevance-ranked search:

```bash
mdgraph query --path /path/to/project 'type:adr AND status:accepted' --json
mdgraph query --path /path/to/project 'type:adr AND edge.IMPLEMENTS ~ auth' --json
mdgraph query --path /path/to/project 'type:runbook AND health:dead_link ORDER BY updated DESC' --json
mdgraph query --path /path/to/project 'updated >= 2026-06-21 AND NOT status:draft LIMIT 25' --json
```

`:` is an alias for `=`. Quote values containing spaces. Keywords and field names are case-insensitive.

### Grammar

```text
query       := expression [ORDER BY sort ("," sort)*] [LIMIT integer]
expression  := or-expression
or          := and (OR and)*
and         := unary (AND unary)*
unary       := NOT unary | "(" expression ")" | predicate
predicate   := field operator value
operator    := = | != | ~ | !~ | < | <= | > | >= | :
sort        := sortable-field [ASC | DESC]
```

`AND` binds more tightly than `OR`. Parentheses make grouping explicit. Input is limited to 10,000 characters, 256 tokens, 64 predicates, 24 nesting levels, three sort fields, and `LIMIT 1..500`.

### Fields

| Field | Meaning | Operators |
|---|---|---|
| `type` | Document kind | `=`, `!=`, `~`, `!~` |
| `status` | Lifecycle status | `=`, `!=`, `~`, `!~` |
| `trust` / `trust_tier` | Trust tier | `=`, `!=`, `~`, `!~` |
| `path`, `title` | Indexed path or title | `=`, `!=`, `~`, `!~` |
| `updated` / `updated_at` | Source file mtime captured during indexing | Date comparisons |
| `indexed` / `indexed_at` | Index timestamp | Date comparisons |
| `tag` / `tags` | Explicit front-matter tags | `=`, `!=`, `~`, `!~` |
| `edge` | Presence of an outgoing edge kind | `=`, `!=` |
| `edge.<KIND>` | Outgoing edge whose target matches an id, path/title, section heading/anchor, entity, or source ref | `=`, `!=`, `~`, `!~` |
| `health` | Doctor-derived document health | `=`, `!=` |

`~` is a case-insensitive substring operation; `%` and `_` are not wildcards. Dates accept `YYYY-MM-DD` or ISO timestamps. Sortable fields are `path`, `title`, `type`, `status`, `trust`, `updated`, and `indexed`.

Health values are `dead_link`, `orphan`, `stale_source_ref`, `missing_definition`, `weakly_linked`, `possible_contradiction`, and `content_risk`. Health predicates refuse stale indexes instead of mixing current files with old graph state.

### Execution and Safety

The parser accepts only documented fields, operators, document kinds, trust tiers, edge kinds, health values, dates, sort fields, and limits. Non-health expressions compile to whitelisted SQL fragments with bound parameters; user values are never interpolated into SQL. Edge kinds, columns, and sort directions enter SQL only after closed-enum validation.

Queries containing health predicates run parameterized atomic document predicates and doctor-derived health sets separately, then evaluate the original boolean AST. This preserves `AND`, `OR`, and `NOT` semantics. Arbitrary front-matter keys, raw SQL, incoming-edge predicates, joins, and aggregations are not supported.

The JSON output contains the validated AST, execution strategy and stages, parameter count, total/returned counts, truncation state, matched documents, reasons, predicate fields, and provenance. The full shape is in [Output Contracts](Output_Contracts.md#query---json-experimental).

## Derived Related-Document Relationships

`relationships derive` creates an optional semantic relationship layer from an already complete real-model vector index. It never runs during ordinary indexing or watch mode, and it never uses `local-hash`.

```bash
mdgraph index --semantic --full --path /path/to/project
mdgraph relationships derive --dry-run --json --path /path/to/project
mdgraph relationships derive --threshold 0.86 --max-neighbors 3 \
  --min-evidence 2 --json --path /path/to/project
```

Always inspect a dry run against your corpus before writing edges. A successful non-dry run atomically replaces earlier `RELATED_TO/embedding_similarity` edges, so reruns do not accumulate duplicates.

### Runtime Gates

Derivation refuses mutation unless all checks pass:

- The doctor content-hash/ID audit reports a fresh index with no Markdown parse failures.
- Embeddings are enabled and the configured provider declares `semantic-model` capability.
- Every indexed chunk has a valid vector for the configured provider, model, and dimensions.
- The threshold is at least `0.75` (default `0.86`).
- Each relationship has at least two independent chunk/section matches above the threshold; one chunk cannot fill multiple evidence slots.
- The pair survives reciprocal top-K selection (default three neighbors per document).

These are conservative emission gates, not a certification of a model or corpus. Calibrate the threshold on representative project documents.

### Algorithm and Resource Bounds

The workflow samples at most 12 evenly distributed chunks per eligible document, averages normalized chunk vectors into a document centroid, filters candidates with a conservative centroid floor, and then checks independent section evidence and reciprocal neighbors.

It fails instead of silently truncating when work would exceed 250,000 document pairs, 2,000,000 section-vector comparisons, or 100,000,000 vector-component comparisons. Documents with fewer than `min-evidence` chunks cannot emit a relationship. `max-neighbors` accepts `1..10`; `min-evidence` accepts `2..4`.

### Stored Edge Contract and Lifecycle

Each accepted pair is stored as two directed `RELATED_TO` edges so outgoing queries work from either document. Edges have low `weight: 2`, `embedding_similarity` provenance, confidence from the required evidence pairs, stable endpoint/kind/provenance IDs, and metadata describing provider, model, dimensions, algorithm, gate, threshold, reciprocal top-K, evidence, symmetry, and generation time.

Derived edges participate in graph retrieval, trace, and structured outgoing-edge queries. Doctor excludes them from authoritative orphan/weak-link counts, so inference cannot hide a missing maintained link. Incremental indexing removes derived edges touching changed or deleted documents; a full rebuild removes the entire derived layer. Run derivation again after semantic reindexing.

Structural GraphJSON includes edge kind, confidence, and provenance but omits edge metadata under its existing privacy profile. See [Output Contracts](Output_Contracts.md#relationships-derive---json-experimental) for the derivation report.

Embedding similarity is not proof of identity, contradiction, causality, or logical equivalence. `SAME_AS` and `CONTRADICTS` remain reserved; explicit author links remain authoritative.

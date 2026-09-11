---
wiki_id: architecture
evidence_hash: 831426a7a0d31c645fcd3264ae4019a6469c049b8de41f7183276a8ac6eb8581
source_docs:
  - docs/ZH/Architecture.md
  - docs/EN/Architecture.md
  - docs/ZH/Knowledge_Cards_and_Wiki_Workflow.md
  - AGENTS.md
  - CONTRIBUTING.md
  - docs/EN/Public_Contracts.md
  - docs/EN/README.md
  - docs/EN/Retrieval_and_Context.md
  - docs/EN/Structured_Query_and_Relationships.md
  - docs/ZH/Public_Contracts_1.0.md
  - docs/ZH/Public_Contracts.md
  - docs/ZH/README.md
source_refs:
  - src/bin/mdgraph.ts
  - src/db/repositories.ts
  - src/db/schema.sql
  - src/extraction/entity-extractor.ts
  - src/indexer.ts
  - src/mcp/tools.ts
  - src/query/context-builder.ts
  - src/query/knowledge-card.ts
  - src/query/search.ts
  - src/query/structured-query-executor.ts
  - src/query/structured-query.ts
  - src/query/trace.ts
  - src/relationships/derive-related.ts
  - src/semantic/ollama-provider.ts
  - src/semantic/provider-registry.ts
  - src/semantic/provider.ts
  - src/types.ts
  - src/wiki/wiki-dependencies.ts
  - src/wiki/wiki-domains.ts
  - src/wiki/wiki-evidence.ts
  - src/wiki/wiki-plan.ts
  - src/wiki/wiki-status.ts
---

# Architecture

MDGraph implements one local pipeline:

```text
scanner -> Markdown parser -> extraction/resolution -> SQLite -> query -> CLI/MCP
```

The architecture keeps deterministic document facts separate from optional inference and from user-authored Wiki prose.

## Module boundaries

| Area | Responsibility |
|---|---|
| `src/scanner` | Select Markdown files from configured include/exclude rules and resource limits. |
| `src/parser` | Parse front matter, headings, Markdown links, WikiLinks, code blocks, and inline code. |
| `src/extraction` / `src/resolution` | Produce deterministic graph records and resolve document/section targets. |
| `src/db` | Own SQLite schema, record replacement, graph queries, FTS, vectors, and diagnostics. |
| `src/query` | Search fusion, context packing, Knowledge Cards, graph trace, and structured query. |
| `src/wiki` | Build WikiPlan/PageBrief, report page impact, and verify user-maintained pages. |
| `src/mcp` / `src/bin` | Expose the five-tool MCP boundary and CLI workflows. |

## Stored data

The database stores documents, sections, entities, source refs, edges, chunks, and optional chunk vectors. Sections are heading-bounded; chunks provide retrieval text; edges carry kind, confidence, weight, and provenance. Graph IDs and hashes are deterministic for the same inputs.

Knowledge Cards and Wiki files do not introduce tables. A Card is assembled from the current structural graph at query time. Wiki pages remain ordinary Markdown controlled by the user; only the generated plan is an artifact.

## Indexing flow

The scanner selects files, the parser produces structured Markdown records, and extraction/resolution emits graph records. `GraphRepository` performs either a full replacement or hash-based incremental document replacement. Optional embedding completes before the repository write, so provider failure cannot commit partial vector coverage.

Changed or deleted documents remove their derived records. Full rebuilding also optimizes and vacuums the database. Explicit derived `RELATED_TO` relationships are outside normal indexing and require a separate provider-gated command.

## Query flow

Search combines FTS5, exact entity, optional semantic, and graph-neighbor channels through reciprocal-rank fusion. Context expands bounded non-containment relationships and packs source sections under a character budget. It defaults to document round-robin; true MMR is opt-in.

`node` resolves a document, section, entity, source ref, or chunk. Supported structural nodes receive a deterministic Knowledge Card with definitions, source refs, related documents, evidence, recovery IDs, and explicit truncation counts. `trace` performs bounded traversal with edge provenance and confidence.

## Wiki flow

`buildWikiPlan` selects only evidence-backed domains from indexed metadata and explicit relationships. Each page has a dependency-local evidence hash, including safe source-file fingerprints. `buildWikiPageBrief` reuses context packing and Cards under a shared budget.

`buildWikiStatus` is read-only and reports current, needs-update, missing, and orphaned pages. `verifyWiki` adds plan, front matter, indexed-document, source-path, evidence, and relative-link checks. Neither function evaluates prose quality or deletes content.

## Key tradeoffs

- Deterministic parsing and explainable relationships take precedence over broader but opaque extraction.
- Source code remains evidence read by the host agent; it is not copied into the Markdown graph.
- Semantic retrieval is optional and degrades to lexical/graph results with diagnostics.
- The stable five-tool MCP surface remains small; experimental structured query, relationship derivation, and Wiki maintenance stay CLI-only.

Return to the [Project Overview](index.md) or continue with [Core Workflows](core-workflows.md).

## Evidence ownership and dependency assessment

Card references distinguish direct facts, inherited document/section context, and related background. `originNodeId` identifies the source; `viaNodeId` identifies an actual connecting node when available. `nextReads` contains bounded readable paths and reasons, and its metadata counts toward the 4,000-character Card JSON budget.

`wiki-evidence.ts` owns content freshness and dependency hashing. `wiki-dependencies.ts` compares selected dependencies and supplies both Brief guidance and page status. Plan v2 snapshots record document hashes and source fingerprints, while `wiki-domains.ts` supplies project-neutral starting points. Updating from a plan preserves authored page choices and exposes new evidence as suggestions. The output directory is excluded from source selection.

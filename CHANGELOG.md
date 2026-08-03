# Changelog

All notable changes to MDGraph are documented here. MDGraph follows semantic versioning for its public releases.

## Unreleased

## 1.1.0 - 2026-08-03

### Added

- Opt-in Ollama embeddings through a provider interface, with batched asynchronous indexing, provider-aware query paths, runtime diagnostics, and atomic failure behavior.
- Source-aware entity extraction for higher-precision technical symbols plus Unicode-aware CJK API routes, configuration keys, and function identifiers.
- Opt-in true MMR context packing, persistent watcher health, and explicit polling fallbacks for environments where native file watching is unreliable.
- An experimental, parameterized `query` DSL for document metadata, tags, outgoing edges, dates, sorting, limits, and selected documentation-health predicates.
- An experimental `relationships derive` workflow for conservative, provider-gated `RELATED_TO` edges with independent evidence, reciprocal-neighbor checks, provenance, and atomic replacement.

### Changed

- `local-hash` is documented and reported as a deterministic lexical feature hash rather than a language-model embedding.
- Public documentation is organized by user task instead of implementation-stage pages, and the npm package uses an explicit documentation allowlist.
- Internal regression suites, evaluation APIs, and release commands use capability names instead of implementation milestone labels.

### Compatibility

- Deterministic indexing, the default context-packing strategy, stable `search`, the five-tool MCP surface, schema version 1, and the public `alpha | cjk` evaluation query-set enum remain unchanged.

## 1.0.0 - 2026-07-12

### Added

- Deterministic Markdown graph extraction for documents, sections, entities, source references, chunks, and explainable edges.
- Local SQLite and FTS5 storage with hash-based incremental indexing and optional local semantic reranking.
- CLI workflows for initialization, indexing, status, search, context packing, node inspection, graph tracing, evaluation, export/import verification, bundles, reports, watch mode, and documentation health checks.
- Five MCP tools for search, context, node inspection, tracing, and freshness-aware status.
- Explainable retrieval with reasons, matched entities, provenance, confidence, source references, risk notes, freshness metadata, and context budgets.
- Deterministic GraphJSON, Mermaid trace, WikiLink Markdown, docs-site data, and generic JSON source-bridge exports.
- Public English and Chinese documentation, agent integration templates, contribution guidance, security reporting, and GitHub community templates.

### Compatibility

- Freezes the documented 1.0 CLI, MCP, config, JSON, graph record, and schema compatibility baseline.
- Requires Node.js `>=22.5.0` and keeps the core indexing and query pipeline local-first without mandatory cloud or LLM services.

### Distribution

- Publishes the public npm package as `@daogee/mdgraph` while retaining the `mdgraph` executable.
- Includes built runtime files, the agent pack, public English and Chinese docs, both README files, the changelog, and the MIT license.

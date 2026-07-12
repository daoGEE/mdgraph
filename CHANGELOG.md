# Changelog

All notable changes to MDGraph are documented here. MDGraph follows semantic versioning for its public releases.

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

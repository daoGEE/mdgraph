# Changelog

All notable changes to MDGraph are documented here. MDGraph follows semantic versioning for its public releases.

## 1.2.0 - 2026-09-12

### Added

- Experimental deterministic Knowledge Cards on `node` plus spare-budget Card summaries in `context`.
- Experimental `wiki plan/brief/status/verify` commands for evidence-backed user-maintained Wiki planning, impact status, and read-only verification.
- A reusable Wiki authoring prompt/skill without changing the five-tool MCP surface or adding a generation provider.
- Returned-evidence retrieval metrics alongside unchanged legacy index-coverage metrics, plus a reproducible performance sampling script.
- CI coverage for Node 22 and 26 and early SQLite compatibility; packaged CLI checks for cards and Wiki briefs.

### Changed

- Knowledge Cards distinguish direct, inherited, and related evidence, preserve source ownership, and provide bounded next-read paths.
- WikiPlan v2 preserves authored page selections during updates, records the output directory and dependency snapshots, and separates suggested pages/sources from selected evidence. Version 1 plans remain readable.
- Wiki briefs and status share dependency assessment, explain unavailable or changed sources, and preserve user-selected references during review. Verification explicitly reports that prose correctness is not evaluated.

### Fixed

- Enforce real served-project boundaries for MCP roots and SQLite/configuration paths, including symbolic links.
- Apply embedding deadlines through complete response bodies and retain lexical fallback and existing indexes on failure.
- Reconcile incremental graph relationships and extraction settings, reuse matching vectors, detect concurrent index commits, and reload watcher configuration without dropping the previous watch.
- Match complete Chinese/entity/configuration-key queries and retain definition evidence; enforce serialized Knowledge Card budgets.
- Verify Wiki evidence against current Markdown hashes and validate maintenance field types.
- Normalize early node:sqlite empty-row behavior and provide actionable recovery when FTS5 is unavailable.
- Update test dependencies to audited Vitest and nanoid versions so the release workflow reports no known vulnerabilities.

### Compatibility

- Deterministic indexing, the default context-packing strategy, stable `search`, the five-tool MCP surface, schema version 1, and the public `alpha | cjk` evaluation query-set enum remain unchanged.
- Supported Node.js builds must provide FTS5 through `node:sqlite`; Node 22.23.2 and 26.5.0 are verified.

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

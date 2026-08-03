---
implements:
  - src/indexer.ts
  - src/db/repositories.ts
  - src/query/context-builder.ts
source_refs:
  - src/db/schema.sql
  - src/types.ts
  - src/semantic/provider.ts
  - src/semantic/provider-registry.ts
  - src/semantic/ollama-provider.ts
---

# MDGraph Architecture

MDGraph uses this implemented pipeline: scanner -> parser -> extractor/resolver -> SQLite storage -> query engine -> CLI/MCP.

## Module Map

| Area | Path | Responsibility |
|---|---|---|
| CLI | `src/bin/mdgraph.ts` | Commands for init, index, status, search, context, node, trace, eval, diff, bundle, report, export, import, semantic status, serve, watch, and doctor; doctor supports `--strict`, `--fail-on`, `--changed`, and `--since`. |
| Config | `src/config/load-config.ts` | Default config, `.mdgraph/config.json` creation, and safe config merging. |
| Scanner | `src/scanner/file-scanner.ts` | Finds Markdown files using include/exclude globs and max file size limits. |
| Parser | `src/parser/*` | Front matter, Markdown AST, headings, code blocks, inline code, Markdown links, and WikiLinks. |
| Extraction | `src/extraction/*` | Converts parsed documents into graph records and deterministic entity/edge signals. |
| Resolution | `src/resolution/link-resolver.ts` | Resolves Markdown and WikiLink targets to indexed documents or sections. |
| Storage | `src/db/*` | SQLite connection, schema, record replacement, incremental updates, graph queries, and storage diagnostics. |
| Query | `src/query/*` | Search ranking, context packing, graph trace, and the experimental structured-query tokenizer/AST/executor. |
| Evaluation | `src/evaluation/*` | Retrieval evaluation cases, expected records, and lightweight metrics for search/context/trace quality. |
| Benchmark | `src/benchmark/*` | Structured with/without-MDGraph agent run record parsing and paired delta aggregation. |
| Bundle | `src/bundle/*` | Private directory graph bundle creation and verification using schema/source/config/document hashes. |
| Reporting | `src/reporting/*` | CI-friendly graph workflow reports that aggregate counts, storage, doctor, eval, bundle, diff, and benchmark summaries. |
| Diff | `src/diff/*` | Git base-ref documentation graph diff and PR impact summary generation. |
| Export/Import | `src/export/*` | Deterministic GraphJSON, Mermaid, Markdown/docs-site, and read-only source bridge adapters. |
| Semantic | `src/semantic/*` | Pluggable embedding providers, the compatibility `local-hash` implementation, opt-in Ollama integration, Float32 vector codec, provider diagnostics, and cosine scoring. |
| MCP | `src/mcp/*` | Newline-delimited JSON-RPC MCP server and tool handlers. |
| Watch | `src/watcher/file-watcher.ts`, `src/watcher/watch-health.ts` | Debounced incremental reindexing via chokidar plus persistent in-process health classification. |
| Analysis | `src/analysis/doctor.ts` | Documentation health and governance report. |

## Public Contract Boundary

The public contract boundary is tracked in [Public_Contracts.md](Public_Contracts.md). In short, CLI command names and documented flags, top-level CLI JSON fields, MCP tool names and input schemas, documented config fields, GraphJSON format v1, public graph record types, active edge kinds, and doctor warning shape are public surfaces. SQLite rowids, FTS shadow tables, private bundle database internals, temporary paths, and implementation helper APIs are internal.

## Data Model

The SQLite database is stored at `.mdgraph/graph.db` and created from `src/db/schema.sql`.

Primary records:

- `documents`: one row per Markdown document, with path, hash, status, type, trust tier, and metadata.
- `schema_metadata`: key/value metadata for current schema version, MDGraph version provenance, update time, and `current`/`legacy` baseline.
- `schema_migrations`: reserved audit table for future real schema migrations.
- `sections`: heading-bounded document regions with anchors and source line ranges. A section's content stops before the next heading at any depth; parent/child context is recovered through graph relationships rather than duplicated chunk text.
- `entities`: symbols, API routes, error codes, config keys, file paths, commands, packages, and concepts.
- `source_refs`: source/config/script paths referenced by documents.
- `edges`: graph relationships with kind, confidence, weight, provenance, and metadata.
- `chunks`: text chunks derived from section content and used by search and context packing.
- `chunks_fts`: external-content FTS5 index for keyword search, keyed by `chunks.rowid` so the source chunk text is not stored a second time inside FTS shadow content tables. CJK text is augmented with lightweight n-gram tokens only in the FTS index content.
- `chunk_vectors`: optional local semantic vectors keyed by chunk and stored as Float32 BLOB rows.

## Indexing Flow

1. `scanMarkdownFiles` selects candidate Markdown files from config.
2. `parseMarkdownDocument` reads front matter and Markdown structure.
3. `buildGraphRecords` synchronously creates deterministic documents, sections, entities, source refs, chunks, and edges.
4. When embedding is enabled, `indexProject` resolves an `EmbeddingProvider` and asynchronously embeds all chunks for a new/provider-changed index or only changed chunks for a matching incremental index.
5. `GraphRepository.replaceAll` writes a full rebuild, or `replaceDocuments` updates changed/deleted documents and their vectors.
6. `indexProject` compares stored hashes and vector profile coverage to choose full or incremental mode.

Embedding completes before either repository write begins. A provider error therefore leaves the prior graph intact instead of committing partial vector coverage. Incremental mode deletes document-derived records for changed and removed files, removes their FTS terms, reinserts changed records, and prunes unreferenced global entities/source refs after cleanup. Full rebuilds optimize and vacuum the SQLite database so old FTS pages and deleted rows do not keep inflating the on-disk file.

## Derived Relationship Flow

`relationships derive` is an explicit post-index workflow; it is not part of ordinary indexing or watch mode. It requires a clean doctor content-hash/ID freshness audit with no parse failures, a configured `semantic-model` provider, and complete vector coverage for the current provider/model/dimensions. `local-hash` is rejected. The implementation samples bounded document chunks, uses normalized document centroids for candidate filtering, requires multiple independent high-similarity section pairs, and keeps only reciprocal top-K neighbors.

Accepted pairs become two symmetric, low-weight `RELATED_TO` edges with `embedding_similarity` provenance and metadata containing provider/model identity, algorithm and gate versions, thresholds, evidence section IDs, and generation time. Replacement is atomic. Incremental indexing removes derived edges connected to changed or deleted documents, while a full rebuild removes the optional layer entirely. See [Structured Query and Relationships](Structured_Query_and_Relationships.md#derived-related-document-relationships) for the workflow, safety budgets, and lifecycle.

Derived edges can contribute to graph retrieval, trace, and structured edge predicates. They are excluded from doctor orphan/weak-link authoritative-link counts so inference cannot conceal missing maintained links.

## Entity Extraction

`extractEntities` is deterministic and source-aware. Explicit front matter and `Defines` sections create definitions. Ordinary prose emits only high-structure references such as API routes, error codes, and shaped config keys; broad PascalCase words are not promoted. Standalone inline code may identify a complete Latin or CJK symbol, while fenced code limits bare symbols to declaration and type-reference contexts. Unicode-aware patterns cover CJK API paths, segmented config keys, and function identifiers. Route boundaries prevent a file path from also producing a truncated route.

`entities.stopEntities` suppresses inferred references of every entity kind, while author-declared definitions remain authoritative. This layer is an interpretable heuristic, not general-purpose NER or a source-language AST. Its signal policy and limits are documented in [Retrieval and Context](Retrieval_and_Context.md#deterministic-entity-extraction).

## Storage Diagnostics

`GraphRepository.storageDiagnostics` powers `mdgraph status --storage` and the storage portion of `mdgraph doctor`. It reports SQLite page counts, freelist state, journal/WAL checkpoint state, table/index/FTS shadow object sizes when `dbstat` is available, path-group content contribution, edge-kind distribution, high-degree nodes, vector storage format, and vector provider counts.

The full storage report is read-oriented observability. `doctor` promotes only a small actionable subset into storage health warnings; it does not create graph edges from storage facts. When storage growth is unexpected, users should first check include/exclude globs and generated/dependency/temp directories, then run `mdgraph index --full` when they need a rebuild plus `VACUUM` compaction.

## Schema Metadata And Workflow Artifacts

`openDatabase` applies the current schema and records schema metadata. Databases created by the current CLI are marked with a `current` baseline. Existing databases that predate metadata are marked `legacy` after the schema table is created. If a database already declares a future schema version, MDGraph refuses to open it before applying local schema SQL, which avoids silently downgrading a newer graph.

`createGraphBundle` writes a private directory bundle under `.mdgraph/bundles/private/`. The bundle contains the SQLite graph, config snapshot, manifest, and a storage/status report. The manifest records schema version, MDGraph version, graph counts, Git provenance when available, a canonical config hash, and a source hash built from sorted document path/hash records. It deliberately omits Markdown body content and the absolute project root.

`verifyGraphBundle` is read-only. It checks manifest shape, bundled database readability, schema version, counts, source/config/document hashes, report hashes, and freshness against the current workspace when a project root is available.

`generateReport` produces a CI-friendly JSON report from the current index. It aggregates schema metadata, counts, storage diagnostics, source hashes, doctor summaries, optional eval metrics, optional bundle verification, optional graph diff, optional paired benchmark summaries, and explicit previous-report state. It does not persist hidden report history.

## Graph Diff

`generateGraphDiff` supports the PR-oriented `diff --base <ref>` path. It resolves the base Git revision, copies tracked files into a temporary directory, writes the current MDGraph config there, indexes that temporary base project, and compares the resulting graph snapshot with the current graph index.

The diff report includes Markdown document additions, modifications, deletions, renames detected by Git, section/source-ref/edge count deltas, doctor warning-code deltas, changed source refs, affected document paths, and short PR summary lines. The base index is isolated in the OS temp directory and removed after the report. Diff does not inspect source-code ASTs, does not infer runtime code impact, and does not replace the current `.mdgraph/graph.db`.

## Interoperability

`buildGraphJsonExport` produces the versioned `mdgraph-graphjson` structural export from the current index. It includes documents, sections, entities, source refs, and edges whose endpoints are present in that structural node set. It preserves the full repository `counts` for status parity and adds `exportedCounts` for the omitted chunk/vector/content boundary. The export deliberately excludes chunk content, section content, vectors, SQLite internals, and the absolute project root.

`verifyGraphJsonExport` validates GraphJSON shape, supported format version, counts, edge endpoints, and `graphHash` without opening or writing the local project database. `import graphjson --verify` is therefore an inspection path, not a merge import.

`formatTraceMermaid` renders existing `traceNodes` results as deterministic Mermaid. Markdown/docs-site exports are derived from GraphJSON facts and produce adapter data only; they do not run a site generator. The generic JSON source bridge reads an explicit MDGraph artifact and returns source-ref match summaries, but it does not create graph edges or affect indexing, query ranking, context packing, or MCP tools.

## Query Flow

`searchGraph` combines and deduplicates:

- FTS5 chunk hits, including lightweight CJK n-gram matches for continuous Chinese/Japanese/Korean text.
- Exact entity matches.
- Optional embedding vector matches.
- Graph neighbors around matching entities.

When the same document or section is reached by multiple paths, search applies reciprocal rank fusion (RRF) across definition, FTS, and optional semantic channels, then keeps the highest base score while merging the main reasons and matched entities so provenance is not lost. Each fused result keeps an explainable `RRF fusion (...)` reason.

The synchronous `searchGraph`, `buildContext`, and `evaluateRetrieval` APIs retain their 1.0 behavior and can execute `local-hash` in process. Their async counterparts resolve external providers such as Ollama and are used by CLI and MCP query paths. Provider unavailability, timeouts, invalid responses, missing models, and missing vector coverage fall back to keyword/entity/graph retrieval with an additive `semanticDiagnostic`; CLI text and non-explain JSON commands also write the diagnostic to stderr.

`buildContext` then starts from ranked search sections, performs bounded graph expansion through non-containment edges, packages selected sections under a character budget, and includes reasons such as FTS hit, semantic hit, exact entity match, or the graph edge traversal path. The compatibility default orders candidates by document round-robin. Opt-in `mmr` maximizes query relevance minus redundancy, uses stored configured-provider vectors when both candidates have them, falls back to deterministic Unicode-token Jaccard otherwise, and prunes same-document near duplicates while preserving a first candidate from each document.

Every context result includes additive packing metadata. When requested through `context --debug`, context building also reports seed nodes, visited nodes, expanded edges, skipped expansion reasons, candidate counts, strategy/similarity selection, per-item query relevance, redundancy penalty and MMR score, redundancy pruning, and budget truncation counts. These diagnostics are not graph facts; they exist to explain context packing and evaluate retrieval quality.

The experimental structured-query path is separate from natural-language search. `structured-query.ts` tokenizes bounded input and validates a typed boolean AST. `GraphRepository` compiles document, tag, date, and outgoing-edge predicates from closed field/operator sets into parameterized SQLite operations. `structured-query-executor.ts` uses that direct SQL path unless the AST contains a doctor-derived health predicate; health queries combine parameterized atomic document-id sets with a fresh doctor report and evaluate the original boolean tree. Source file mtime is captured in the existing `documents.updated_at` column during indexing so date governance queries require no schema migration.

`traceNodes` performs bounded graph traversal between resolved nodes and returns each step with edge kind, provenance, and confidence.

`evaluateRetrieval` and `evaluateRetrievalAsync` run the repository-owned alpha or CJK evaluation cases against an indexed project. They reuse the corresponding search/context path plus `traceNodes`, then report expected-document recall, expected-section recall, context precision, trace success, latency, returned character budget, context diversity, reason coverage, RRF channels, query mode, optional semantic reranker status, and async provider diagnostics. The evaluation output is a measurement aid, not a learned ranking model and not a replacement for focused regression tests.

`generateBenchmarkReport` consumes structured `AgentRunRecord` JSON only. It pairs one `with_mdgraph` and one `without_mdgraph` record by `questionId`, reports incomplete or duplicate pairs as skipped, and calculates deltas for file reads, searches, tool calls, MDGraph calls, character/token budgets, latency, raw-file fallback, and citation correctness. It does not parse transcripts, invoke models, or host agent runs.

## MCP Boundary

The MCP server intentionally exposes only five tools. Search and context dispatch through the async provider-aware handlers, while node, trace, and status retain their synchronous behavior. Tool output is text-first and JSON-compatible so agents can use it without needing to inspect the SQLite database or read raw files first. A semantic fallback adds a text banner and structured diagnostic without turning a usable lexical/graph result into an MCP error. The server is project-bound: initialize roots and tool `projectPath` values must stay inside the served root.

## Current Tradeoffs

- `local-hash` remains a deterministic lexical feature hash for compatibility, not a language-model embedding. Ollama is the first opt-in `semantic-model` provider and requires a separately running local service/model. Unsupported or unavailable providers degrade to FTS5 and graph search; `semantic status` reports capability, runtime availability, vector coverage, storage format, and reindex guidance.
- Structured `query` is experimental and covers documented stored fields, tags, outgoing edges, and selected doctor health classes. Arbitrary front-matter keys, incoming-edge predicates, aggregations, joins, and an MCP structured filter remain outside the current implementation.
- Watch mode updates SQLite on file changes and retains `starting | healthy | degraded | failed` health, the last successful index, the last error, and coverage reliability. Startup registration errors are fatal; indexing errors can recover after a later successful index; runtime resource failures remain degraded until restart. Integrated MCP exposes the snapshot through `mdgraph_status`. Native events remain the default, while `watch --poll` and `serve --mcp --watch-poll` are explicit higher-cost fallbacks.
- Doctor checks are rule-based warnings. They first compare current files with indexed document hashes and IDs; stale indexes produce a read-only freshness diagnostic instead of mixed-time health conclusions.
- `doctor --changed` and `doctor --since <ref>` are Git-scoped views over the same health model; they report scope metadata, scoped graph issues, directly related one-hop graph documents, deleted-document warnings, and freshness diagnostics.
- Storage diagnostics are exposed through `status --storage` and reused by doctor for storage health summaries; they are not graph facts and do not expand the MCP tool surface.
- Private bundle artifacts are local workflow artifacts, not public exports. Public-safe sanitization and zip packaging are outside the current implementation.
- Benchmark reports are aggregate-only measurements from explicit structured records; full transcripts, hosted analytics, and agent runtime capture stay outside MDGraph.
- Interoperability adapters are read-oriented. GraphJSON verify, Mermaid/Markdown/docs-site exports, and source bridge reports do not merge external graphs into the main SQLite index.
- `RELATED_TO` is an experimental derived edge emitted only by explicit provider-gated execution; it is never emitted by ordinary deterministic indexing. `SAME_AS` and `CONTRADICTS` remain reserved, and contradiction-like signals continue to be reported by `doctor` rather than inserted as graph edges.
- The current implementation favors a compact, deterministic core over broad Markdown/MDX dialect support.

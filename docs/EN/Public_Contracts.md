---
source_refs:
  - src/bin/mdgraph.ts
  - src/types.ts
  - src/db/schema.sql
---

# MDGraph Public Contracts

This document records the public contract boundary for the current release line, anchored to the frozen `1.0.0` compatibility baseline. It complements [Output_Contracts.md](Output_Contracts.md), [Architecture.md](Architecture.md), and [Release_Checklist.md](Release_Checklist.md). The full per-command, per-format, per-config, and per-schema inventory lives in the [1.0 Contract Freeze Appendix](Public_Contracts_1.0.md).

## Stability Labels

- `stable`: users and agents may rely on this shape. Additive fields are allowed; removing or renaming documented fields is a breaking change after 1.0.
- `stable-additive`: existing fields and semantics are stable, and the surface may gain optional fields or metrics when old consumers remain valid.
- `experimental`: available without a stable compatibility promise; semantics may be adjusted with changelog notes, migration guidance where needed, and focused tests.
- `reserved`: named for future use, but not active until an emitter or workflow is documented and tested.
- `internal`: implementation detail. It may change without compatibility guarantees.

## Contract Ledger

| Surface | Status | Owner | Contract |
|---|---|---|---|
| Package root JavaScript/TypeScript exports | experimental | `src/index.ts`, `package.json` | The package root exposes the documented ESM entry point and matching TypeScript declarations. Individual helper exports remain experimental unless another row explicitly freezes their behavior or record shape. |
| CLI command names and documented flags | stable | `src/bin/mdgraph.ts` | `usage`, `init`, `index`, `status`, `search`, `context`, `node`, `trace`, `eval`, `semantic status`, `bundle create/verify`, `export`, `import graphjson --verify`, `diff`, `report`, `serve --mcp`, `watch`, and `doctor`. Project-related commands support additive `--path <project>` where applicable. `context` adds optional `--packing` and `--mmr-lambda`; `serve --mcp` adds explicit `--watch-poll`; `watch` adds explicit `--poll`. `status --freshness` remains additive without changing the default `status --json` shape. |
| Project-wide `--path` for project-related commands | stable-additive | `src/bin/mdgraph.ts` | Project-related commands (`init`, `index`, `status`, `search`, `context`, `node`, `trace`, `eval`, `semantic status`, `bundle create/verify`, `export`, `import graphjson --verify`, `diff`, `report`, `serve --mcp`, `watch`, `doctor`, and `usage`) accept an additive `--path <project>` flag so agents and scripts can target a repository without changing the shell cwd. |
| `mdgraph usage` command | stable-additive | `src/bin/mdgraph.ts` | `usage` prints an agent-friendly workflow guide and `usage --json` returns the same workflows as machine-readable JSON without reading or writing the graph index. |
| Experimental structured `query` command | experimental | `src/query/structured-query.ts`, `src/query/structured-query-executor.ts`, `src/bin/mdgraph.ts` | `query <expression>` provides a bounded typed DSL over documented document fields, tags, outgoing edges, dates, sorting/limits, and doctor health. It supports `--json` and `--path`; it does not change stable `search` or the five-tool MCP surface. |
| Experimental `relationships derive` command | experimental | `src/relationships/derive-related.ts`, `src/bin/mdgraph.ts` | Explicitly derives low-weight symmetric `RELATED_TO` edges from complete semantic-model vectors after freshness, capability, coverage, threshold, independent-evidence, reciprocal-top-K, and resource-budget checks. It supports dry-run and never runs automatically during index/watch. |
| `status --freshness` diagnostics | stable-additive | `src/bin/mdgraph.ts` | `status --freshness` adds optional freshness diagnostics (`state`, `recommendation`, `lastIndexedAt`, `checkedAt`, `issues`) without changing the default `status --json` shape; `--storage` and `--freshness` may be combined. |
| `serve --mcp` default watch and `--no-watch` escape hatch | stable-additive | `src/bin/mdgraph.ts` | `serve --mcp` keeps the Markdown graph fresh by default and exposes `--no-watch` as the read-only escape hatch; `--watch`, `--semantic`, `--debounce <ms>`, and explicit `--watch-poll` are additive flags for integrated watch-based freshness. |
| Top-level CLI JSON output shapes | stable | `docs/EN/Output_Contracts.md` | Required fields documented in Output Contracts are stable; command-specific nested graph records follow `src/types.ts` unless a section, such as experimental structured `query` or `relationships derive`, is explicitly marked otherwise. |
| MCP tool names and input schemas | stable | `src/mcp/tools.ts` | Exactly five tools: `mdgraph_search`, `mdgraph_context`, `mdgraph_node`, `mdgraph_trace`, and `mdgraph_status`; schemas reject undeclared properties. |
| MCP structured freshness metadata | stable-additive | `src/mcp/tools.ts` | `mdgraph_status` always returns `freshness` metadata in `structuredContent` when indexed, and `mdgraph_search`/`mdgraph_context`/`mdgraph_node`/`mdgraph_trace` may add the same `freshness` object plus a text warning banner when the index is `stale` or `unknown`. |
| MCP semantic fallback diagnostics | stable-additive | `src/mcp/tools.ts` | `mdgraph_search` and `mdgraph_context` use the async provider path. When semantic retrieval cannot run, they keep lexical/graph results and prepend a text warning. Search adds `structuredContent.semanticDiagnostic`; context adds `structuredContent.context.semanticDiagnostic`. Both contain `code`, `provider`, `message`, and `degraded: true`. |
| Context packing selection | stable-additive | `src/query/context-builder.ts`, `src/mcp/tools.ts` | Existing callers retain `mmr-style-document-round-robin`. CLI `--packing mmr`, MCP `mdgraph_context.packingStrategy`, and library options select true MMR. Context output adds `packing`; debug output adds similarity, lambda, selection scores, and redundancy skip diagnostics. |
| Watch health and polling | stable-additive | `src/watcher/file-watcher.ts`, `src/watcher/watch-health.ts`, `src/mcp/tools.ts` | `WatchHandle.getHealth()` exposes in-process state, timestamps, last error, coverage reliability, polling, and closure. Integrated MCP status may add `structuredContent.watchHealth`. Polling is enabled only by `watch --poll`, `serve --mcp --watch-poll`, or `usePolling: true`. |
| Structured query AST and execution | experimental | `src/query/structured-query.ts`, `src/query/structured-query-executor.ts`, `src/db/repositories.ts` | User values use bound SQL parameters. Field/operator/sort/edge enums are validated before whitelisted SQL assembly. Health predicates require a fresh doctor report and preserve the original boolean AST. No arbitrary front-matter or raw SQL escape is exposed. |
| Derived relationship execution | experimental | `src/relationships/derive-related.ts`, `src/db/repositories.ts` | `RELATED_TO/embedding_similarity` edges are non-authoritative, low weight, atomically replaceable, and carry provider/model/algorithm/threshold/evidence/generation metadata. `local-hash` cannot emit them. GraphJSON retains its structural privacy profile and therefore omits this edge metadata. |
| MCP text output wording | experimental | `src/mcp/tools.ts` | Text is human-facing guidance; `structuredContent` is the preferred machine contract. |
| Context recovery fields | stable-additive | `src/query/context-builder.ts` | Context items expose `nodeId`, `documentId`, optional `sectionId`, optional `anchor`, line ranges, source refs, risk notes, and graph-expansion `edgePath` so agents can recover nodes and provenance without guessing from prose. |
| `.mdgraph/config.json` fields | stable | `src/config/load-config.ts` | `docs`, `index`, `search`, `entities`, and `embedding` default fields are stable. The additive embedding fields are `endpoint`, `timeoutMs`, and `batchSize`; existing config files receive defaults. Unknown fields are currently ignored by merge logic. |
| `.mdgraph` file governance | stable | `src/config/load-config.ts`, `src/bin/mdgraph.ts` | `mdgraph init` keeps `.mdgraph/config.json` trackable, protects local `.mdgraph` artifacts through the root `.gitignore` when no equivalent ignore rule exists, and builds the initial graph index by default. `.mdgraph/graph.db` and generated `.mdgraph` artifacts are local workflow state, not source files. Use `--no-index` for config-only initialization. |
| SQLite schema metadata | stable | `src/db/schema.sql`, `src/db/connection.ts` | `schema_metadata.schema_version` gates compatibility. Future schema versions fail before local schema is applied. |
| SQLite table internals | internal | `src/db/schema.sql` | Rowids, FTS shadow tables, vector blob representation internals, and private bundle database contents are not public API. |
| Public graph record types | stable | `src/types.ts` | `GraphDocument`, `GraphSection`, `GraphEntity`, `SourceRef`, `GraphEdge`, `GraphChunk`, `ChunkVector`, `SearchResult`, and `TraceStep`. |
| Edge kinds | stable/experimental/reserved | `src/types.ts` | Existing explicit edge kinds are stable. `RELATED_TO` is an experimental opt-in derived kind identified by `DERIVED_EDGE_KINDS`; `SAME_AS` and `CONTRADICTS` remain reserved until separate emitters are documented and tested. |
| Doctor warning shape | stable | `src/analysis/doctor.ts` | Warnings include `code`, `severity`, `message`, `evidence`, `affectedNodes`, and `remediation`. Warning codes are versioned by changelog and tests. |
| GraphJSON export and verify | stable format v1 | `src/export/graphjson.ts` | `format: "mdgraph-graphjson"`, `formatVersion: 1`, structural profile, deterministic ordering, and `graphHash` verification. |
| Bundle manifest | experimental | `src/bundle/bundle.ts` | `formatVersion: 1` private workflow artifact. It is not a public sanitized exchange format. |
| Report, diff, and benchmark JSON | experimental | `src/reporting`, `src/diff`, `src/benchmark` | CI-facing workflow outputs; required top-level fields are documented, but detailed metrics may expand while the surface remains experimental. |
| Semantic vector provider behavior | experimental | `src/semantic/*` | `local-hash` remains a `lexical-hash` compatibility provider; Ollama is the first opt-in `semantic-model` provider. External providers run only through async indexing/query APIs and must degrade queries to FTS5/graph search with diagnostics when unavailable or unsupported. Explicit indexing failures must not commit partial graph/vector updates. |

## Compatibility Policy

- Additive JSON fields are allowed when existing documented fields keep their meaning.
- Removing, renaming, or changing the type of a documented stable field is breaking after 1.0.
- Optional CLI flags may be added when default behavior is unchanged.
- MCP tool names and required inputs are stable; optional inputs may be added when old clients continue to work.
- Unknown future GraphJSON fields may be ignored when required v1 fields are valid.
- Unsupported future `formatVersion` values must fail with actionable upgrade guidance.
- Error payloads should include a stable `code` and remediation when the command already returns structured errors.
- Non-zero exit behavior is part of the contract for failed verification, invalid bundle verification, strict doctor gates, and invalid command usage.

## Schema And Config Strategy

- Existing databases with no metadata are treated as `legacy` after metadata tables are created.
- Databases with a future `schema_version` fail before local schema SQL is applied.
- Existing migration helpers may update storage internals when the resulting public graph records stay compatible.
- Schema changes that cannot be safely migrated must fail with rebuild or upgrade guidance.
- New config fields must have defaults and must not make existing config files invalid unless the change is explicitly documented as breaking.
- Config numeric and path-related limits are part of the safety contract, not optional tuning hints.

## Release Matrix

Every release must preserve the stable 1.0 baseline and validate all `stable-additive` surfaces, including `usage`, project-wide `--path`, `status --freshness`, MCP freshness metadata, context recovery fields, optional context packing, watch health, and default fresh MCP serving. Experimental structured query, semantic-provider, and derived-relationship behavior must remain explicitly labeled and covered by focused tests.

Before a release that changes public surfaces:

- Run `npm run docs:check`, `npm run typecheck`, focused contract tests, `npm test`, `npm run build`, `npm run smoke:cli`, `npm run smoke:eval`, `npm run smoke:pack`, `npm run task:public-check`, and `git diff --check`.
- Run `npm pack --dry-run` when package metadata or included public docs change.
- Validate on Node.js `>=22.5.0`; the regular development baseline is the current Node 22.x line.
- Treat Linux and Windows full CI as the release-gate baseline, and keep macOS covered by CI smoke for build-output CLI and packed-artifact behavior.
- Use release maintainer smoke, not CI, for platform-specific long-running surfaces such as `serve --mcp` and `watch`.
- Keep any external-corpus evaluation data outside the public repository unless it is independently licensed and intentionally adopted as a public fixture.

## Release Readiness

A release is ready only after:

- The ledger above is current for every touched public surface.
- Critical public shapes are protected by focused tests or smoke gates.
- Experimental and internal surfaces are explicitly labeled in docs.
- Known output-shape inconsistencies are either normalized or intentionally documented in the release.
- The release checklist can catch accidental public contract drift.

---
wiki_id: reference
evidence_hash: c3ec2a257aed83db744060a6e3340634e92addbff4f1b2b7b58c4cc7a95f65a0
source_docs:
  - docs/EN/Output_Contracts.md
  - docs/EN/Public_Contracts.md
  - docs/ZH/Public_Contracts.md
  - docs/EN/Architecture.md
  - docs/EN/Public_Contracts_1.0.md
  - docs/EN/README.md
  - docs/EN/Release_Checklist.md
  - docs/EN/Structured_Query_and_Relationships.md
  - docs/ZH/Architecture.md
  - docs/ZH/Output_Contracts.md
  - docs/ZH/Public_Contracts_1.0.md
  - docs/ZH/README.md
source_refs:
  - src/bin/mdgraph.ts
  - src/db/repositories.ts
  - src/db/schema.sql
  - src/indexer.ts
  - src/mcp/tools.ts
  - src/query/context-builder.ts
  - src/query/knowledge-card.ts
  - src/query/structured-query-executor.ts
  - src/query/structured-query.ts
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

# Reference

## CLI groups

| Workflow | Commands |
|---|---|
| Setup and lifecycle | `init`, `index`, `status`, `watch`, `serve --mcp` |
| Retrieval | `search`, `context`, `node`, `trace`, `eval` |
| Governance and health | `query`, `doctor`, `diff`, `report` |
| Interoperability | `export`, `import graphjson --verify`, `bundle create/verify` |
| Optional semantics | `semantic status`, `relationships derive` |
| User Wiki | `wiki plan`, `wiki brief`, `wiki status`, `wiki verify` |

Project-related commands accept `--path <project>`. Commands with machine contracts accept `--json`. Use `mdgraph help <command>` for complete option syntax.

## MCP tools

The MCP surface intentionally contains exactly five tools:

- `mdgraph_status`: availability, counts, freshness, and integrated watcher health.
- `mdgraph_search`: ranked document/section discovery with reasons and matched entities.
- `mdgraph_context`: the primary task-start documentation brief with budgets and recovery fields.
- `mdgraph_node`: resolved node data, related edges, and an optional deterministic Knowledge Card.
- `mdgraph_trace`: a bounded provenance-preserving path between two nodes.

Wiki, doctor, structured query, exports, and relationship derivation remain CLI workflows.

## Configuration

`.mdgraph/config.json` contains stable sections for `docs`, `index`, `search`, `entities`, and `embedding`. Default indexing is local and deterministic. Embedding configuration is optional; `local-hash` is a lexical compatibility feature hash, while semantic-model providers such as Ollama require explicit setup.

Generated `.mdgraph` database and workflow artifacts are local state. The configuration file remains trackable.

## Output and evidence contracts

Search results retain document, optional section, score, reason, content, matched entities, and optional semantic metadata. Context results retain budget, packing metadata, item recovery IDs/paths/anchors/lines, source refs, risk notes, edge paths, optional Card summaries, and content.

Knowledge Cards are experimental stable-additive projections on supported `node` results. New WikiPlan artifacts use format version 2; version 1 remains readable and can be migrated with an explicit Wiki directory. WikiPageBrief, WikiStatus, and WikiVerification retain version 1 with additive evidence and maintenance fields. Verification issues contain a code, message, recovery action, and page/path evidence when available.

## Compatibility

The 1.0 baseline freezes documented stable CLI names, five MCP tools, config defaults, public graph records, active edge kinds, GraphJSON v1, schema metadata, and doctor warning shape. Structured query, derived relationships, Knowledge Cards, and the Wiki group are post-freeze experimental additions. They do not change stable search behavior, GraphJSON v1, SQLite schema version 1, or MCP tool count.

Return to the [Project Overview](index.md), [Development Guide](development.md), or [Operations and Troubleshooting](operations.md).

## Additive Knowledge and Wiki fields

Card references may contain `association: direct | inherited | related`, `originNodeId`, and `viaNodeId`. Optional `nextReads` supplies real paths and graph-backed reasons.

Plan v2 adds `wikiDir`, dependency snapshots, `suggestions.pages`, `suggestions.sources`, and `gaps`. `wiki plan --from <plan> --out <next-plan>` preserves authored page fields; v1 migration also requires `--wiki-dir`.

Brief adds `supplementaryDocuments`, `sourceInspections`, `evidenceGaps`, and `dependencyEvidence`. Its budget measures packed context and serialized cards, not the entire JSON envelope. Status adds dependency and source-selection changes. Verify reports `scope: maintenance-and-evidence` and `contentReview: not-evaluated`, so `valid: true` does not certify content correctness.

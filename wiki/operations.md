---
wiki_id: operations
evidence_hash: 1eea7fe8dea23ea1563b0b362e41155a30be25ce5172736bd85238248c3567f1
source_docs:
  - docs/ZH/Operations.md
  - docs/EN/Operations.md
  - agent-pack/prompts/status-doctor.md
  - docs/EN/Release_Checklist.md
  - docs/ZH/Release_Checklist.md
  - agent-pack/README.md
  - CHANGELOG.md
  - docs/EN/Evaluation_Questions.md
  - docs/EN/Output_Contracts.md
  - docs/EN/Public_Contracts.md
  - docs/EN/README.md
  - docs/EN/Retrieval_and_Context.md
source_refs:
  - src/bin/mdgraph.ts
  - src/db/schema.sql
  - src/extraction/entity-extractor.ts
  - src/indexer.ts
  - src/query/context-builder.ts
  - src/query/search.ts
  - src/semantic/ollama-provider.ts
  - src/semantic/provider.ts
  - src/semantic/status.ts
  - src/types.ts
  - src/watcher/file-watcher.ts
  - src/watcher/watch-health.ts
  - src/wiki/wiki-dependencies.ts
  - src/wiki/wiki-domains.ts
  - src/wiki/wiki-evidence.ts
---

# Operations and Troubleshooting

## Check operational state

Start with lightweight availability and freshness:

```bash
mdgraph status --freshness --path /project
```

Use `status --storage --freshness --json` when database growth, WAL state, edge distribution, or vector storage needs inspection. Use `doctor --json` for full content-hash freshness and documentation-health conclusions.

## Keep the index fresh

`mdgraph serve --mcp` performs one index and starts integrated watch mode by default. Native file events are the normal path. Polling is explicit because it increases I/O and CPU:

```bash
mdgraph serve --mcp --watch-poll --path /project
mdgraph watch --poll --path /project
```

Use `serve --mcp --no-watch` for a read-only server or pair it with a separately supervised watcher.

## Interpret watcher failures

Watcher health distinguishes startup, runtime-resource, and indexing failures. Startup registration failures such as permission or descriptor exhaustion are fatal. Runtime resource failures make coverage unreliable until restart. An indexing failure can recover after a later successful update.

When native watching fails:

1. Read the reported code and phase.
2. Fix permissions or resource limits when possible.
3. Restart the watcher after runtime coverage loss.
4. Opt into polling only when native events remain unavailable.

## Semantic provider failures

The default deterministic retrieval path needs no external provider. When an optional provider is configured, query-time unavailability, timeout, invalid response, missing model, or incomplete coverage produces a diagnostic and falls back to lexical/entity/graph retrieval.

Explicit semantic indexing is stricter: embeddings complete before graph replacement. A provider error leaves the previous index intact. Check `mdgraph semantic status` for capability, endpoint availability, vector profile, and reindex guidance.

## Stale indexes and document health

- `status --freshness` is a quick path/mtime check.
- `doctor --json` performs content-hash and graph health checks.
- `doctor --changed` and `doctor --since <ref>` scope findings to Git changes while retaining explicit scope metadata.
- Reindex after Markdown changes; use `index --full` when a rebuild and compaction are required.

## Wiki recovery

`wiki status` gives every non-current page a reason and recovery action. Regenerate a stale plan before accepting a new evidence hash. Create missing pages from their brief. Review orphaned pages manually. `wiki verify` exits non-zero for missing, stale, orphaned, unsafe-source, or unresolved-link failures but never edits files.

See [Core Workflows](core-workflows.md) for normal operation and [Reference](reference.md) for exact output contracts.

## Interpret Wiki changes

`changes` lists modified, deleted, or unavailable dependencies. `selectionChanges` lists page front-matter sources added to or missing from the plan. Review the selections, refresh the index/plan, and update affected prose. A new unrelated document can require plan review while unaffected pages remain current.

`current` means recorded dependencies and maintenance fields match. `wiki verify` checks maintenance and evidence only; it does not evaluate the truth of prose. If an update is unsuitable, restore the preserved plan/page copy. If a source is unavailable, restore it or explicitly revise the selected dependency before refreshing the plan.

If indexing reports `sqlite_fts5_unavailable`, switch to a Node.js build with FTS5 (22.23.2 and 26.5.0 were verified), then rerun `mdgraph index`. This diagnoses a runtime requirement before applying persistent schema changes.

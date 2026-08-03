---
title: Operations
type: runbook
status: active
defines:
  - MDGraphOperations
source_refs:
  - src/indexer.ts
  - src/watcher/file-watcher.ts
  - src/watcher/watch-health.ts
  - src/semantic/status.ts
---

# Operations

This guide covers index freshness, watch coverage, semantic-provider recovery, and local artifact safety for long-running MDGraph use.

## Index and Freshness Checks

Use explicit status checks before relying on an unfamiliar or long-running project index:

```bash
mdgraph status --freshness --path /path/to/project
mdgraph status --storage --path /path/to/project
mdgraph doctor --path /path/to/project
```

`status --freshness` compares current Markdown files with indexed paths and hashes. A `stale` result means query results may reflect older graph state; run `mdgraph index`. Doctor health predicates and derived-relationship generation require a fresh index and refuse mixed-time conclusions.

Incremental indexing updates changed and deleted documents, their FTS records, vectors, and connected derived edges. Use `index --full` when the embedding profile changes, when storage needs rebuild/compaction, or when a clean reconstruction is operationally preferable.

## Watch Modes

Standalone watch mode and integrated MCP serving keep the index current:

```bash
mdgraph watch --path /path/to/project
mdgraph serve --mcp --path /path/to/project
```

The watcher exposes an in-process health snapshot through `WatchHandle.getHealth()`. Integrated MCP serving adds it to `mdgraph_status.structuredContent.watchHealth`.

| State | Meaning | Operator action |
|---|---|---|
| `starting` | Watch registration or initial setup is in progress. | Wait for healthy state or startup failure. |
| `healthy` | Registration is active and the latest index attempt succeeded. | No action. |
| `degraded` | Indexing failed, or native watch coverage is no longer reliable. | Inspect the last error; reindex or restart after fixing the cause. |
| `failed` | Startup could not establish reliable watch coverage. | Fix the reported error before relying on watch mode. |

The snapshot includes last successful index time, last error, failure phase and normalized code, consecutive indexing failures, coverage reliability, polling state, and closure state. It lasts for the watcher process; restart creates a new health lifecycle.

Startup registration errors are fatal. A later successful index can recover an indexing failure. Runtime watch errors such as `ENOSPC` or `EMFILE` set `coverageReliable: false`; a successful manual or triggered index does not prove missed native events are recovered, so health remains degraded until restart.

## Polling Fallback

Native filesystem events are the default. If operating-system watch limits cannot be raised or native events are unreliable, explicitly enable polling:

```bash
mdgraph watch --poll --path /path/to/project
mdgraph serve --mcp --watch-poll --path /path/to/project
```

Polling is never activated automatically because it can increase I/O and CPU use. Prefer fixing the operating-system resource limit for large, long-running repositories when possible; use polling when that is not under your control.

## Semantic Provider Recovery

Check provider and vector state with:

```bash
mdgraph semantic status --path /path/to/project
```

| Condition | Query behavior | Recovery |
|---|---|---|
| Provider unavailable, timeout, or invalid response | Search/context fall back to FTS5/entity/graph and report `semanticDiagnostic`. | Restore the service/model, then retry; the lexical result remains usable. |
| Provider/model/dimensions changed | Status reports that reindexing is needed. | Run `mdgraph index --full --semantic`. |
| Semantic indexing fails | The existing graph remains intact because embedding completes before mutation. | Fix the provider and rerun indexing. |
| Vector coverage is incomplete | Semantic queries degrade; relationship derivation refuses mutation. | Rebuild a complete semantic index. |

`local-hash` does not require an external service, but it is only a lexical feature hash. It cannot satisfy semantic-model gates for derived relationships.

## Derived Relationship Refresh

Derived `RELATED_TO` edges are disposable, non-authoritative state. Changes to a document remove touching derived edges; a full rebuild removes all of them. After a successful full semantic index, run a dry derivation and then explicitly refresh the layer if desired. See [Structured Query and Relationships](Structured_Query_and_Relationships.md#derived-related-document-relationships).

## Local and Release Artifacts

- Keep `.mdgraph/graph.db`, bundles, reports containing local paths, and private evaluation corpora out of source control and release archives.
- Keep `.mdgraph/config.json` trackable when it contains no credentials; endpoint URLs with embedded credentials are rejected.
- Use GraphJSON for the documented structural exchange format instead of depending on SQLite internals.
- Before publishing MDGraph itself, run the [Release Checklist](Release_Checklist.md), inspect `npm pack --dry-run --json`, and verify the packed package rather than assuming repository contents equal npm contents.

---
wiki_id: core-workflows
evidence_hash: 874323b9d635caf762ddf252f09eb8a05f3ccd85a8037cc1db1ddd93e9e9b1db
source_docs:
  - docs/ZH/Retrieval_and_Context.md
  - docs/ZH/Structured_Query_and_Relationships.md
  - agent-pack/prompts/relationship-trace.md
  - docs/EN/Retrieval_and_Context.md
  - docs/EN/Structured_Query_and_Relationships.md
  - docs/ZH/Knowledge_Cards_and_Wiki_Workflow.md
  - agent-pack/prompts/task-start-context.md
  - docs/EN/Knowledge_Cards_and_Wiki_Workflow.md
  - agent-pack/README.md
  - docs/EN/Architecture.md
  - docs/EN/Evaluation_Questions.md
  - docs/EN/Operations.md
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
  - src/semantic/status.ts
  - src/types.ts
  - src/watcher/file-watcher.ts
  - src/watcher/watch-health.ts
  - src/wiki/wiki-dependencies.ts
  - src/wiki/wiki-domains.ts
  - src/wiki/wiki-evidence.ts
  - src/wiki/wiki-plan.ts
  - src/wiki/wiki-status.ts
---

# Core Workflows

## Index a project

Run `mdgraph init` once, then use incremental indexing after Markdown changes:

```bash
mdgraph init --path /project --docs "docs/**/*.md"
mdgraph index --path /project
mdgraph status --freshness --path /project
```

Use `--full` when a rebuild and compaction are required. Add `--semantic` only when an explicitly configured provider should create vectors; lexical, entity, and graph retrieval remain available without it.

## Start a coding task

For a task that crosses design documents, ADRs, runbooks, APIs, or known source paths:

1. Check `mdgraph_status` when index availability is unclear.
2. Call `mdgraph_context` with the task text and any `knownFiles`.
3. Use the returned reasons, source refs, risk notes, and recovery fields directly.
4. Read only the exact Markdown sections or source files still needed.

Context is usually the best first call because it combines ranking, bounded graph expansion, diversity, and a character budget.

## Locate and explain graph facts

- Use `search` when the target name or path is fuzzy. Results retain score, reason, matched entities, and content.
- Use `node` for a known document title/path, section path and anchor, entity, source ref, or graph ID. Its Card summarizes graph facts without copying chunk prose.
- Use `trace` to explain how two resolved nodes relate. Each step reports edge direction, kind, provenance, and confidence.
- Use structured `query` for experimental governance predicates over stored document metadata; it is separate from natural-language search.

## Optional related-document derivation

`relationships derive` is an explicit post-index workflow for a complete semantic-model vector profile. It applies freshness, provider, coverage, similarity, independent-evidence, reciprocal-neighbor, and resource gates before atomically replacing low-weight `RELATED_TO` edges. It never runs automatically.

## Connect an agent

`mdgraph serve --mcp --path /project` starts the five-tool stdio server and keeps documentation fresh with integrated watch mode by default. `--no-watch` provides a read-only server, and a separate `mdgraph watch` process is also supported.

The agent pack contains host examples, shared instructions, focused prompts, and the `wiki-authoring` skill. Host agents should use MDGraph for documentation context and normal source tools for implementation evidence.

## Maintain a project Wiki

```bash
mdgraph index --path /project
mdgraph wiki status wiki --plan wiki/wiki-plan.json --json --path /project
mdgraph wiki plan --from wiki/wiki-plan.json --out .mdgraph/wiki-plan.next.json --path /project
mdgraph wiki brief architecture --plan .mdgraph/wiki-plan.next.json --json --path /project
# After reviewing sources and updating the page:
mdgraph wiki verify wiki --plan .mdgraph/wiki-plan.next.json --json --path /project
```

Plan defines evidence-backed pages. Brief scopes one authoring task. Status reports impact without writing. Verify checks maintenance front matter, current evidence, source paths, and relative links. The host agent writes prose and preserves correct user edits.

## Boundaries

- Indexing does not parse source ASTs or persist source bodies.
- Search and trace rankings are not changed by Knowledge Cards.
- Wiki commands do not add MCP tools or generation providers.
- Missing benchmark or model evidence may limit claims, but does not disable safely attemptable deterministic workflows.

See [Operations and Troubleshooting](operations.md) for recovery and [Reference](reference.md) for exact surfaces.

## Review evidence before accepting a page

The Brief separates primary `sourceDocuments`, `supplementaryDocuments`, `sourceInspections`, and `evidenceGaps`. Check both index freshness and page dependency status: Markdown can be current while a referenced source file has changed. Stale or unknown material remains viewable, but must be refreshed before accepting its evidence hash.

Adopt useful suggestions explicitly in the plan, then refresh it before writing. Preserve additional user-selected references while deciding whether to include them; do not erase them solely to satisfy verification. Once the page and content checks pass, preserve the previous plan and promote the reviewed next plan.

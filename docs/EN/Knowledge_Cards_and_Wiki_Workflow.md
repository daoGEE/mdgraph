---
status: implemented
defines:
  - KnowledgeCard
  - WikiPlan
  - WikiPageBrief
  - WikiStatus
  - WikiVerification
source_refs:
  - src/query/knowledge-card.ts
  - src/query/context-builder.ts
  - src/query/search.ts
  - src/query/trace.ts
  - src/db/repositories.ts
  - src/mcp/tools.ts
  - src/bin/mdgraph.ts
  - src/wiki/wiki-plan.ts
  - src/wiki/wiki-status.ts
  - src/wiki/wiki-evidence.ts
  - src/wiki/wiki-dependencies.ts
  - src/wiki/wiki-domains.ts
---

# Knowledge Cards and Wiki Workflow

Knowledge Cards help locate and interpret graph evidence. Wiki commands prepare and maintain a project manual whose prose is written by the host agent or user. Neither capability requires a model, embeddings, a source-code graph, or another database.

## Knowledge Cards

`node` and MCP `mdgraph_node` expose an experimental `card`. `context` adds a complete `cardSummary` only when packed Markdown leaves enough space. Search ranking, trace paths, and the five-tool MCP surface are unchanged.

A card retains `nodeId`, `kind`, `label`, `summary`, `definitions`, `sourceRefs`, `relatedDocuments`, `evidence`, and optional `truncated`. Additive `nextReads` entries supply graph-backed paths and reading reasons.

References carry `association` (`direct`, `inherited`, or `related`), `originNodeId`, and optional `viaNodeId`. A section's own evidence is direct; document-level declarations are inherited background. A document may aggregate its sections while retaining the originating node. An entity's source files reached through a defining document are related evidence, not a claim that the entity directly implements all of those files.

The deterministic summary emphasizes location and useful relationships. Next reads come from existing graph facts. The default complete serialized JSON budget is 4,000 characters, including ownership metadata, next reads, and omission counts. Direct evidence has priority over inherited/related background. Display text can end in an ellipsis; the stable node identity is retained. An impossible budget produces an explicit error. Cards are generated at query time and are not persisted or exposed through a separate command.

## Create a Wiki plan

```bash
mdgraph wiki plan --wiki-dir wiki --out .mdgraph/wiki-plan.json --path <project>
mdgraph wiki brief <page-id> --plan .mdgraph/wiki-plan.json --json --path <project>
```

Plan v2 records the project-relative Wiki output directory and excludes it from source selection. Project-neutral candidate domains cover overview, architecture, usage, development, operations, and reference; indexed document evidence supplies project vocabulary. Sparse documentation produces limited suggestions and explicit gaps rather than invented project behavior.

Pages retain stable IDs, output paths, purpose, audience, outline, selected document IDs, selected source paths, evidence queries, and a dependency-local evidence hash. Dependency snapshots let maintenance reports identify changed files. Global graph hashes remain diagnostic data; changes to indexing metadata alone do not imply that every page needs rewriting.

## Update an authored plan

```bash
mdgraph wiki plan --from .mdgraph/wiki-plan.json --out .mdgraph/wiki-plan.next.json --path <project>
```

Review the next plan before replacing the previous one. Existing page IDs, paths, hierarchy, titles, purposes, audiences, outlines, selected documents, source refs, and evidence queries are preserved. New pages and sources are suggestions rather than automatic edits. Missing selected dependencies remain visible instead of silently disappearing. Adopt suggestions by editing the selected page fields and refreshing the plan before writing from its brief.

Version 1 plans remain readable. When migrating with `--from`, supply `--wiki-dir wiki` explicitly; write the resulting version 2 plan to a new file. Future unknown formats are diagnosed without overwriting the input. Plan, brief, status, and verification never author or overwrite page prose.

## Author one page

A brief identifies primary selected documents, supplementary retrieved material, source files to inspect, and unresolved evidence gaps. Knowledge Cards distinguish direct facts from background. The `maxChars`/`usedChars` budget covers packed context text and serialized cards; page instructions and the source manifest are separate recovery information, not a total JSON-size cap.

The shared evidence evaluation supplies freshness and recovery information to JSON, text, and writing requirements. A stale or unknown brief remains readable, but it does not instruct the author to finalize an old evidence hash. Refresh sources/index/plan as directed, inspect the cited files, then write or update the page.

Maintain these fields:

```yaml
---
wiki_id: architecture
evidence_hash: "<hash from the current brief>"
source_docs:
  - docs/architecture.md
source_refs:
  - src/main.ts
---
```

Both source fields must be arrays of non-empty project-relative paths; use `[]` for an empty list. Additional user-selected sources must be deliberately incorporated into the plan. A mismatch should be resolved by reviewing source selection, not by blindly removing the user's references.

Use [the authoring workflow](../../agent-pack/skills/wiki-authoring/SKILL.md) to preserve correct existing prose and update only affected pages.

## Status, verification, and content acceptance

```bash
mdgraph wiki status wiki --plan .mdgraph/wiki-plan.json --json --path <project>
mdgraph wiki verify wiki --plan .mdgraph/wiki-plan.json --json --path <project>
```

`current` means no change was detected in the recorded dependencies and maintenance fields. `needs_update`, `missing`, and `orphaned` identify work to review. Reports include dependency changes and recovery actions. A new unrelated source can require plan review without forcing unrelated pages to be rewritten. Status and verification preserve user content.

Verification checks maintenance fields, safe existing sources, relative links, and evidence consistency. `valid: true` is not a judgment of prose accuracy. Content acceptance separately records the task performed, actual commands, observed results, the source revision, and any unverified claims.

## Validation

Focused regression tests cover ownership, budgets, stale evidence, preserved author choices, plan compatibility, and the complete update workflow. `npm run baseline:knowledge-wiki` measures output behavior on a small orchard project; it is not an independent-agent A/B trial or evidence of improved prose quality. `npm run baseline:performance` measures synthetic 100/500-document workloads.

The maintained project Wiki in `wiki/` and its `wiki/acceptance.md` record document real workflow validation. Their acceptance is separate from unit-test success.

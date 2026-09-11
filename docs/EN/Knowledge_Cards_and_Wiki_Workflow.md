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
---

# Knowledge Cards and Wiki Workflow

## Decision

MDGraph treats Knowledge Cards and Wiki authoring as separate capabilities.

- A **Knowledge Card** is a compact query-time projection over the current graph. It
  enriches the existing `node` and `context` workflows first, without producing files,
  adding MCP tools, or creating another knowledge store.
- A **Wiki** is a user-facing project manual. MDGraph deterministically plans pages,
  prepares evidence briefs, reports update impact, and verifies references. The host
  agent reads project process documents and source code, then authors or updates the
  delivery Markdown.

MDGraph does not select or invoke a prose-generation model. Existing optional
embeddings remain retrieval-only.

## Non-goals

- No card CLI/MCP tool or persisted card table.
- No static card repository or GraphJSON/edge dump presented as a Wiki.
- No source-code graph inside MDGraph.
- No built-in Ollama/generation provider or Wiki vector index.
- No automatic overwrite of user-maintained Wiki prose.
- No claim that agent-authored prose is byte-deterministic.

## Knowledge Card

```ts
interface KnowledgeCard {
  nodeId: string;
  kind: "document" | "section" | "entity" | "source_ref";
  label: string;
  summary: string;
  definitions: CardReference[];
  sourceRefs: CardSourceReference[];
  relatedDocuments: CardReference[];
  evidence: CardEvidence[];
  truncated?: Record<string, number>;
}
```

The summary is deterministic template text, not an LLM summary. Records retain graph
IDs, project-relative paths, line ranges, edge kinds, provenance, and confidence when
available.

### Integration

- `node`: add an experimental `card` field and render the full compact card in text mode.
- `context`: add only bounded `cardSummary` data for selected items and count it in
  `usedChars`; omit summaries that do not fit, preserving source content and recovery fields.
- `search`: keep ranking and JSON shape unchanged in the first batch.
- `trace`: keep path semantics unchanged in the first batch.
- MCP remains exactly five tools.

Suggested defaults are eight definitions, eight source refs, eight related documents,
twelve evidence records, and 4,000 characters per card. Truncation reports omitted
counts. The initial implementation uses the existing graph only.

## Wiki Workflow

```text
documentation graph + task + known source paths
    -> WikiPlan
    -> WikiPageBrief
    -> host agent reads documentation and source
    -> host agent authors/updates Markdown
    -> WikiStatus + WikiVerification
```

Commands:

```bash
mdgraph wiki plan --out .mdgraph/wiki-plan.json --path <project>
mdgraph wiki brief <page-id> --plan .mdgraph/wiki-plan.json --json --path <project>
mdgraph wiki status <wiki-dir> --plan .mdgraph/wiki-plan.json --json --path <project>
mdgraph wiki verify <wiki-dir> --plan .mdgraph/wiki-plan.json --json --path <project>
```

There is no `wiki generate` command.

### WikiPlan

```ts
interface WikiPlan {
  format: "mdgraph-wiki-plan";
  formatVersion: 1;
  graphHash: string;
  sourceHash: string;
  pages: Array<{
    id: string;
    title: string;
    path: string;
    parentId?: string;
    purpose: string;
    audience: string;
    outline: string[];
    documentIds: string[];
    sourceRefs: string[];
    evidenceQueries: string[];
    evidenceHash: string;
  }>;
}
```

Planning uses document types, headings, front matter, explicit links, entities, and
source refs. It creates only evidence-backed pages; candidate domains include overview,
architecture, core workflows, development, operations, and reference.

### WikiPageBrief

A brief contains the page goal/audience/outline, authoritative `sourceDocuments`,
bounded existing context items, Knowledge Cards, source paths needing code inspection,
writing requirements, and suggested next queries. It reuses current context budgets
and recovery fields. Both plan and brief add `strictFreshness` with the strict
Markdown content-hash diagnosis available at creation time; when it is stale or
unknown, index before treating the evidence as current.

### Delivery front matter

```yaml
---
wiki_id: architecture-overview
evidence_hash: "..."
source_docs:
  - docs/EN/Architecture.md
source_refs:
  - src/indexer.ts
  - src/db/repositories.ts
---
```

`source_docs` and `source_refs` must be arrays of non-empty project-relative paths.
Scalar values, empty entries, and mixed arrays are invalid evidence and `wiki verify`
reports an exact recovery action. User prose remains editable and is never overwritten
by status or verification.

### Status and verification

Page states are `current`, `needs_update`, `missing`, and `orphaned`. Status compares
the plan evidence hash with page front matter and runs a strict content-hash check of
indexed Markdown. A source document changed or deleted on disk marks only pages that
use it as `needs_update`, even when its mtime was preserved. A newly added document
makes the plan stale and tells the maintainer to index and regenerate it; it does not
mark unrelated pages as needing an update.

Verification checks plan format/version, page identity, indexed source documents,
safe project-relative source refs, internal Markdown links, strict evidence freshness,
and missing/orphaned pages. An unknown or stale strict index is invalid until the
project is indexed again. It does not judge prose quality or require model review.

## Implementation batches

1. **Remove the wrong public direction:** do not merge experimental static Wiki/Card
   export work; preserve existing GraphJSON/docs-site/source-bridge behavior.
2. **Dynamic Card:** implement `src/query/knowledge-card.ts`, then integrate `node` and
   `context` with strict budgets and provenance tests.
3. **Plan and Brief:** add deterministic WikiPlan v1 and context-backed WikiPageBrief.
4. **Status and Verify:** add evidence hashes, missing/orphaned detection, source/link
   checks, and executable recovery guidance.
5. **Agent workflow and real validation:** add a reusable authoring prompt/skill and use
   MDGraph itself to produce a real user manual.

## Acceptance

Knowledge Cards must improve node orientation without changing search ranking, trace
paths, SQLite counts, or context budgets. They remain byte-stable for the same graph.

Wiki plan/brief/status/verify must work without models, embeddings, or a Source Bridge.
The same graph produces stable plans and briefs; changing one dependency marks only
affected pages; user prose is never overwritten; every failure includes a recovery
action.

User validation covers understanding the product, installation/indexing, agent setup,
the five tools, and operational recovery. Agent A/B compares first-correct-file hit,
context size, correctness, and completion time. No measured gain means no broader card
or Wiki automation.

## Implementation status

The Dynamic Card, Plan/Brief, Status/Verify, CLI, and host-agent authoring workflow are
implemented. `node` exposes full Cards, `context` uses only spare budget for Card
summaries, and `wiki plan/brief/status/verify` remains an experimental CLI-only group.
The repository-owned `wiki/` manual and `agent-pack/skills/wiki-authoring` exercise the
real workflow without adding a model provider or changing the five-tool MCP surface.

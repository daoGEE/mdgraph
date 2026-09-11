---
wiki_id: development
evidence_hash: b55fb67da0b029121f79d9c86e61849e002363ce565e5590decb1347824f7d29
source_docs:
  - CONTRIBUTING.md
  - AGENTS.md
  - docs/EN/Architecture.md
  - docs/EN/Evaluation_Questions.md
  - README-ZH.md
  - README.md
source_refs:
  - src/db/repositories.ts
  - src/db/schema.sql
  - src/indexer.ts
  - src/query/context-builder.ts
  - src/query/knowledge-card.ts
  - src/semantic/ollama-provider.ts
  - src/semantic/provider-registry.ts
  - src/semantic/provider.ts
  - src/types.ts
  - src/wiki/wiki-dependencies.ts
  - src/wiki/wiki-plan.ts
  - src/wiki/wiki-status.ts
---

# Development Guide

## Prerequisites and setup

Use Node.js with `node:sqlite` and FTS5; Node.js 22.23.2 and 26.5.0 were verified for this revision. From a source checkout:

```bash
npm install
npm run typecheck
npm test
npm run build
```

The project is TypeScript ESM with NodeNext resolution. Local TypeScript imports use the compiled `.js` extension form.

## Repository boundaries

Keep the implemented pipeline recognizable: scanner, parser, extraction/resolution, SQLite, query, CLI/MCP. Reuse existing module boundaries instead of scattering parsing, normalization, path safety, or policy decisions across call sites.

Public graph types live in `src/types.ts`, and the SQLite schema lives in `src/db/schema.sql`. A change to public outputs, edge kinds, types, or storage structures requires focused tests and synchronized documentation.

Knowledge Cards belong to `src/query` because they are dynamic projections. Wiki planning and verification belong to `src/wiki`; they must not create a second index, call a model, or write page prose.

## Verification strategy

Use Vitest tests under `__tests__`. During iteration, run the smallest affected suite; before handoff, broaden verification according to the changed surface:

```bash
npm test -- __tests__/wiki-workflow.test.ts
npm run typecheck
npm test
npm run build
```

For CLI changes, build first and exercise non-daemon commands with JSON output. Watcher and MCP changes require their dedicated integration tests. A successful Node `node:sqlite` experimental warning is informational.

## Change workflow

1. Use CodeGraph first when `.codegraph/` is present and code location or call paths are unclear.
2. Use MDGraph for architecture, contract, runbook, and cross-document questions.
3. Read the exact code being modified and preserve unrelated working-tree edits.
4. Add focused success-path tests through the real integration boundary.
5. Update English and Chinese contracts together when public behavior changes.
6. Run broader gates once the capability-domain batch is coherent.

## Contribution checks

Contributions should preserve local-first deterministic behavior and explain the coding-agent workflow improved by a feature. Optional semantic providers must fail atomically during indexing and degrade queries to lexical/graph results with diagnostics. Guards must preserve legitimate workflows and provide a stable reason plus recovery action.

Continue with [Architecture](architecture.md) for system boundaries or [Reference](reference.md) for compatibility details.

## Knowledge and Wiki regression checks

Run `npm test -- __tests__/knowledge-card-ownership.test.ts __tests__/wiki-plan-update.test.ts __tests__/wiki-maintenance.test.ts __tests__/knowledge-wiki-contracts.test.ts` when changing these workflows. Tests cover section/background ownership, real intermediate nodes, plan migration, preserved selections, CLI/MCP output, and dependency update success.

`npm run baseline:knowledge-wiki` measures a fixed orchard example; `npm run baseline:performance` measures 100/500 synthetic documents. Output-label coverage and local latency are engineering observations, not proof of independent-agent task performance.

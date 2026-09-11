---
wiki_id: project-overview
evidence_hash: d4d27e529d50265d016722f319d49ff3e3e7d5d9f0ec46811ba58fbf4fd34cb3
source_docs:
  - README-ZH.md
  - README.md
  - agent-pack/README.md
  - docs/EN/README.md
  - docs/ZH/README.md
  - AGENTS.md
  - CHANGELOG.md
  - CONTRIBUTING.md
  - agent-pack/host-examples.md
  - agent-pack/mdgraph-agent-instructions.md
  - agent-pack/prompts/relationship-trace.md
  - agent-pack/prompts/status-doctor.md
source_refs: []
---

# MDGraph Project Overview

MDGraph is a local-first Markdown document graph for AI coding workflows. It turns maintained project documentation into deterministic documents, sections, entities, source references, and explainable relationships stored in local SQLite. Coding agents can ask focused questions without treating a whole documentation tree as an unstructured prompt.

It is deliberately not a source-code graph, hosted RAG service, general personal knowledge base, or required LLM runtime. The core indexing and query path works without cloud services, embeddings, or a generation model.

## Core concepts

- A document and its heading-bounded sections remain recoverable by project-relative path, anchor, and line range.
- Entities represent explicit or high-structure concepts such as symbols, APIs, error codes, configuration keys, commands, and file paths.
- Source refs connect documentation claims to project files without indexing source code into a second knowledge store.
- Edges preserve kind, provenance, and confidence so search, context, node inspection, and trace results stay explainable.
- Knowledge Cards are compact, deterministic query-time views. They are not stored as another database.
- The Wiki workflow plans and verifies a user-maintained manual; MDGraph never generates or overwrites its prose.

## Install and create the first index

MDGraph requires a Node.js build with `node:sqlite` and SQLite FTS5. This revision was verified with Node.js 22.23.2 and 26.5.0. The official 22.5.0 build lacks FTS5 and cannot create the index; use a verified runtime instead.

```bash
npm install -g @daogee/mdgraph
mdgraph init --path /absolute/path/to/project --docs "docs/**/*.md"
```

`init` writes `.mdgraph/config.json`, protects local artifacts, and builds the initial index unless `--no-index` is supplied. Later documentation changes can be indexed incrementally:

```bash
mdgraph index --path /absolute/path/to/project
mdgraph status --freshness --path /absolute/path/to/project
```

## First useful query

Start with context when the task crosses documents:

```bash
mdgraph context --path /absolute/path/to/project \
  "what should I read before changing authentication recovery?"
```

Use `search` to locate candidates, `node` to inspect one resolved graph node and its Knowledge Card, and `trace` to explain a relationship. An MCP host exposes exactly five tools: search, context, node, trace, and status.

## Where to go next

- [Architecture](architecture.md) explains implemented module and data boundaries.
- [Core Workflows](core-workflows.md) covers indexing, retrieval, graph navigation, agent setup, and Wiki maintenance.
- [Development Guide](development.md) covers repository changes and verification.
- [Operations and Troubleshooting](operations.md) covers freshness, watch mode, doctor, and provider failures.
- [Reference](reference.md) collects command, MCP, configuration, and output contracts.

## Maintaining this Wiki

The tracked `wiki/wiki-plan.json` records selected evidence and the `wiki` output directory. Refresh from the existing plan to preserve authored selections. Review suggestions, fetch a brief for one page, update only affected prose, and verify against the reviewed next plan:

```bash
mdgraph index --path /absolute/path/to/project
mdgraph wiki status wiki --plan wiki/wiki-plan.json --json --path /absolute/path/to/project
mdgraph wiki plan --from wiki/wiki-plan.json --out .mdgraph/wiki-plan.next.json --path /absolute/path/to/project
mdgraph wiki brief project-overview --plan .mdgraph/wiki-plan.next.json --json --path /absolute/path/to/project
# After reviewing sources and updating the page:
mdgraph wiki verify wiki --plan .mdgraph/wiki-plan.next.json --json --path /absolute/path/to/project
```

Status and verification are read-only. An orphaned page is reported for review and is never deleted automatically.

The repository's [Wiki Workflow Acceptance](acceptance.md) records the current package, command, maintenance-flow checks, output comparisons, and their limits.

## Version and acceptance scope

This manual describes the source revision identified in [the acceptance record](acceptance.md). The local package was installed and exercised during validation; registry releases can differ. After a Wiki update passes verification and content review, retain a backup and promote the reviewed next plan to `wiki/wiki-plan.json`. For a new Wiki, use `wiki plan --wiki-dir wiki --out <plan>`; add `--wiki-dir wiki` when migrating an old v1 plan.

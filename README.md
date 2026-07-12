<div align="center">

# MDGraph

### Your repository already explains itself. Make the connections visible to coding agents.

**MDGraph turns project Markdown into a local, explainable graph—so agents know what to read, how documents relate, and why each result matters.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/daoGEE/mdgraph/actions/workflows/ci.yml/badge.svg)](https://github.com/daoGEE/mdgraph/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/Node-%3E%3D22.5.0-brightgreen.svg)](https://nodejs.org/)
[![Release](https://img.shields.io/github/v/release/daoGEE/mdgraph?include_prereleases&label=release)](https://github.com/daoGEE/mdgraph/releases)

<a href="./README-ZH.md">简体中文</a> · <a href="./docs/EN/Architecture.md">Architecture</a> · <a href="./docs/EN/Agent_Integration.md">Agent Integration</a> · <a href="./docs/EN/Public_Contracts.md">Public Contracts</a> · <a href="./docs/EN/Output_Contracts.md">Output Contracts</a>

</div>

---

## Stop Rediscovering the Same Architecture

The answer is usually already in the repository—split across an ADR, a design doc, an API note, and the runbook nobody remembered to open.

Text search finds matching words. MDGraph finds the surrounding decision, the connected documents, and the path between them. It then gives the agent a compact context package with explicit reasons and provenance.

```text
$ mdgraph context "How does indexing flow from Markdown files to agent context?"

docs/EN/Architecture.md:49  ·  Indexing Flow
Reason: FTS5 content match; RRF fusion

1. scanMarkdownFiles selects candidate Markdown files.
2. parseMarkdownDocument reads front matter and Markdown structure.
3. buildGraphRecords creates nodes, chunks, vectors, and edges.
4. GraphRepository writes a full or incremental update.
```

One question. The right section. A visible reason—not a black-box answer.

---

## From Install to First Answer

```bash
npm install -g @daogee/mdgraph
mdgraph init --path /path/to/your/project --docs "docs/**/*.md"
mdgraph context --path /path/to/your/project "Which ADRs constrain the authentication design?"
```

`init` creates a trackable `.mdgraph/config.json`, protects local graph artifacts through `.gitignore`, and builds the first index. Your Markdown and SQLite graph stay on your machine.

### Connect an AI Coding Agent

```json
{
  "mcpServers": {
    "mdgraph": {
      "type": "stdio",
      "command": "mdgraph",
      "args": [
        "serve",
        "--mcp",
        "--path",
        "/absolute/path/to/project"
      ]
    }
  }
}
```

The server indexes on startup and keeps the graph fresh as Markdown changes. If your MCP host does not inherit the shell `PATH`, replace `mdgraph` with the absolute path reported by `which mdgraph` (macOS/Linux) or `where mdgraph` (Windows).

---

## Five Tools, One Documentation Layer

| When the agent needs to… | It calls… | What comes back |
|---|---|---|
| Find a decision, command, path, API, or error | `mdgraph_search` | Ranked matches with reasons |
| Start a task with the right documentation | `mdgraph_context` | A budgeted, source-backed context package |
| Inspect a known document, section, or entity | `mdgraph_node` | The resolved node and its provenance |
| Understand how two things connect | `mdgraph_trace` | An explainable graph path |
| Know whether results are safe to trust | `mdgraph_status` | Index availability and freshness |

MDGraph extracts relationships from headings, front matter, Markdown links, WikiLinks, inline code, code blocks, and explicit source references. The core index is deterministic: no LLM-generated summaries and no remote embedding service are required.

---

## Built for the Gap Between Search and Understanding

| Tool | Best at | What MDGraph adds |
|---|---|---|
| `grep` / file search | Exact text and fast ad hoc lookup | Document relationships, ranked context, provenance, and freshness |
| Vector RAG | Fuzzy semantic similarity across broad content | Deterministic extraction and useful local retrieval without remote models |
| Source code graphs | Symbols, calls, and implementation structure | Decisions, runbooks, specs, and other Markdown knowledge |

MDGraph does not replace those tools. It gives coding agents a documentation layer for the intent, decisions, operational knowledge, and cross-file relationships that source code alone does not carry.

### Evidence With Its Limits Intact

- Repository-owned evaluation fixtures cover ADRs, designs, APIs, runbooks, incidents, source references, superseded documents, and CJK retrieval.
- Every search and context result retains a reason; graph traces retain edge kinds, provenance, and confidence.
- Linux and Windows run the full CI gate; macOS runs build and package smoke checks.
- The `1.0.0` public CLI, MCP, config, JSON, and schema surfaces have a documented compatibility baseline.

These are deterministic engineering checks, not a claim of a completed real-agent benchmark. See [Evaluation Questions](./docs/EN/Evaluation_Questions.md) and [Public Contracts 1.0](./docs/EN/Public_Contracts_1.0.md) for the methodology and limits.

---

## Common Commands

```bash
# Refresh the graph manually
mdgraph index --path /your/project

# Check availability, counts, and freshness
mdgraph status --freshness --path /your/project

# Search and context-pack from the CLI
mdgraph search --path /your/project "authentication timeout"
mdgraph context --path /your/project "why does RedisTimeoutError affect login"

# Resolve one node or trace a graph path
mdgraph node --path /your/project "AuthService"
mdgraph trace --path /your/project "AuthService" "RedisTimeoutError"

# Documentation health checks
mdgraph doctor --path /your/project
mdgraph doctor --since origin/main --fail-on warn --json --path /your/project

# Agent-friendly workflow guide
mdgraph usage --path /your/project
```

Use `mdgraph help` or `mdgraph help <command>` for the full CLI reference.

---

## Why Teams Can Trust It

- **Local by default.** Markdown, chunks, vectors, and SQLite artifacts stay in the project environment.
- **Explainable by design.** Results retain matching reasons, entities, edge provenance, confidence, paths, and budget information where relevant.
- **Deterministic at the core.** The same Markdown produces stable graph records without requiring an LLM.
- **Fresh during active work.** Hash-based incremental indexing updates changed documents; MCP watch mode keeps later queries current.
- **Honest about risk.** `doctor` surfaces dead links, stale source refs, missing definitions, content risks, storage health, and stale indexes.

---

## Documentation Map

- `docs/EN/Architecture.md` — pipeline, module boundaries, data flow, tradeoffs.
- `docs/EN/Agent_Integration.md` — MCP setup, shared agent instructions, host notes.
- `docs/EN/Public_Contracts.md` — stable public surfaces, compatibility policy, release gates.
- `docs/EN/Public_Contracts_1.0.md` — 1.0 contract-freeze appendix with the frozen CLI, config, MCP, JSON, and schema inventory for the current `1.0.0` baseline.
- `docs/EN/Output_Contracts.md` — JSON output shapes for CLI and MCP consumers.
- `docs/EN/Evaluation_Questions.md` — retrieval/evaluation prompts.
- `docs/EN/Release_Checklist.md` — release validation checklist.
- `agent-pack/` — reusable MCP config, instructions, and prompt templates.

---

## Community

- Found a bug or have a focused feature idea? [Open an issue](https://github.com/daoGEE/mdgraph/issues/new/choose).
- Want to improve MDGraph? Read [CONTRIBUTING.md](./CONTRIBUTING.md).
- Found a security issue? Follow [SECURITY.md](./SECURITY.md) instead of posting sensitive details publicly.
- If MDGraph helps your team, star the repository and share the workflow that worked for you. Real examples are the most useful signal for the roadmap.

---

## Requirements

- Node.js `>=22.5.0`
- SQLite support from Node's built-in `node:sqlite`
- Markdown files in a local project directory

`node:sqlite` may print an experimental warning on current Node versions. Treat it as informational when commands exit successfully.

---

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

Useful smoke checks:

```bash
npm run smoke:cli
npm run smoke:eval
npm run smoke:pack
npm run task:public-check
```

---

## License

MIT

# MDGraph Documentation

[简体中文](../ZH/README.md)

MDGraph documentation is organized by user task. Start with the repository [README](https://github.com/daoGEE/mdgraph#readme) for installation and a first query, then use the guide that matches what you are trying to do.

## Use MDGraph

- [Agent Integration](Agent_Integration.md) — connect MDGraph to an MCP host and give coding agents a reliable documentation workflow.
- [Retrieval and Context](Retrieval_and_Context.md) — understand search channels, optional semantic providers, entity extraction, CJK handling, and context packing.
- [Structured Query and Relationships](Structured_Query_and_Relationships.md) — run governance queries and explicitly derive non-authoritative related-document edges.
- [Operations](Operations.md) — keep indexes fresh, interpret watcher health, use polling safely, and recover from provider or file-watcher failures.

## Integrate and Maintain MDGraph

- [Architecture](Architecture.md) — implemented pipeline, module boundaries, data model, and tradeoffs.
- [Output Contracts](Output_Contracts.md) — machine-readable CLI and MCP result shapes.
- [Public Contracts](Public_Contracts.md) — compatibility labels and the current public boundary.
- [1.0 Contract Freeze](Public_Contracts_1.0.md) — versioned inventory of the stable 1.0 baseline.
- [Evaluation](Evaluation_Questions.md) — public evaluation commands, reference questions, and repository regression suites.
- [Release Checklist](Release_Checklist.md) — maintainer checks for GitHub and npm releases.

Experimental commands are labeled in their guides and output contracts. Their presence does not change the deterministic default indexing pipeline, the stable `search` command, or the five-tool MCP surface.

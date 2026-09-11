---
name: wiki-authoring
description: Author or update a user-maintained project Wiki from MDGraph plans and page evidence. Use for project handbook creation and maintenance.
---

# Wiki Authoring

MDGraph locates evidence and reports dependency changes. The host agent reads source material and writes the prose.

## Workflow

1. Check index availability and refresh stale Markdown evidence within the user's requested maintenance scope.
2. For a new Wiki, run `mdgraph wiki plan --wiki-dir <wiki-dir> --out <plan-file> --path <project>`. For an existing Wiki, first run `wiki status <wiki-dir> --plan <plan-file> --json --path <project>`.
3. Update an existing plan with `wiki plan --from <plan-file> --out <next-plan> --path <project>`. Add `--wiki-dir <wiki-dir>` when migrating a v1 plan. Review suggestions and gaps. Keep stable page IDs, user-authored goals, outlines, and source selections. Explicitly adopt useful suggested pages/sources before refreshing the plan. Preserve the previous file for recovery.
4. Run `wiki brief <page-id> --plan <reviewed-plan> --json --path <project>` for each affected page. Inspect `strictFreshness`, `dependencyEvidence`, and `evidenceGaps`. A stale or unknown brief can be read, but its evidence hash must not be treated as current.
5. Read `sourceDocuments` as the selected primary material. Use `supplementaryDocuments` for additional context and perform the listed `sourceInspections` before making implementation claims. Card association distinguishes direct evidence, inherited context, and related background.
6. Preserve correct existing prose. Update only affected pages unless the user asks for a broader rewrite. Maintain:

   ```yaml
   ---
   wiki_id: <page-id>
   evidence_hash: <hash from the current reviewed brief>
   source_docs:
     - <project-relative-markdown-path>
   source_refs:
     - <project-relative-source-path>
   ---
   ```

   Both source fields are arrays; use `[]` when empty. If the author needs additional sources, add them to the plan's selected dependencies and refresh its evidence before synchronizing the page. Do not discard user-selected references merely to make verification pass.
7. Run `wiki verify <wiki-dir> --plan <reviewed-plan> --json --path <project>`. Repair issues attributable to the current page and preserve unrelated pages. Review orphaned pages without automatically deleting them.
8. Separately check prose correctness: execute the key documented workflow, inspect supporting source, and record commands, outcomes, the code revision, and unverified claims. `current` and `valid: true` describe dependency/maintenance consistency; they do not prove prose accuracy.

## Recovery

Restore the previous plan or page copy if an update is unsuitable. For changed dependencies, refresh the index and plan, then obtain a new brief. For unavailable paths, inspect the reported source and restore it or explicitly revise the selection. Keep Wiki output outside its own source evidence.

The workflow remains usable without embeddings, a Source Bridge, or a generation provider. MDGraph commands never generate or overwrite Wiki prose.

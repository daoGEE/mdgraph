---
name: wiki-authoring
description: Author or update a user-maintained project Wiki from MDGraph WikiPlan and WikiPageBrief evidence. Use for project handbook or Wiki creation and maintenance; do not use for docs-site exports or unrelated single-document edits.
---

# Wiki Authoring

Use MDGraph for deterministic planning, evidence collection, impact status, and verification. The host agent writes the prose after reading the cited documents and source files.

## Workflow

1. Confirm the project has a usable index. Create or refresh it only when the user authorized indexing.
2. Create a plan with `mdgraph wiki plan --out <plan-file> --path <project>` when no current plan exists.
3. For an existing Wiki, run `mdgraph wiki status <wiki-dir> --plan <plan-file> --json --path <project>`. Update only `needs_update` and `missing` pages unless the user asks for a broader rewrite.
4. Before writing one page, run `mdgraph wiki brief <page-id> --plan <plan-file> --json --path <project>`.
5. Read the brief's source documents and inspect its source refs before making behavioral claims. Treat suggested headings as guidance rather than required prose.
6. Preserve user-authored content that remains correct. Keep this maintenance front matter synchronized with the brief:

   ```yaml
   ---
   wiki_id: <page-id>
   evidence_hash: <page-evidence-hash>
   source_docs:
     - <project-relative-markdown-path>
   source_refs:
     - <project-relative-source-path>
   ---
   ```

7. Run `mdgraph wiki verify <wiki-dir> --plan <plan-file> --json --path <project>`. Repair the current page's reported issues before moving to another page.

## Boundaries

- `wiki plan`, `brief`, `status`, and `verify` do not generate or overwrite Wiki prose.
- Keep every maintenance path project-relative. Do not replace evidence paths with absolute paths.
- If plan evidence is stale, regenerate the plan and brief before updating `evidence_hash`.
- Treat `orphaned` pages as user content requiring review; do not delete them automatically.
- Verification checks structure, evidence freshness, source paths, and relative links. It does not prove that prose is accurate or well written.
- The workflow must remain usable without embeddings, Source Bridge, a local model, or a remote generation service.

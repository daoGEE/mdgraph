# Wiki Authoring Prompt

Part of the [MDGraph Agent Pack](../README.md).

Use this when the host supports prompts but not reusable skills.

1. Generate or read the current WikiPlan. If status reports a stale or unknown index, run `mdgraph index`, regenerate the plan, and then continue.
2. Run `wiki status` before a batch update and select only `needs_update` or `missing` pages.
3. Fetch one WikiPageBrief at a time. Read its process documents and inspect its source refs before writing behavioral claims.
4. Write a coherent user manual page rather than concatenating graph records or Card summaries.
5. Preserve correct user prose and maintain `wiki_id`, `evidence_hash`, `source_docs`, and `source_refs`. The two source fields must be arrays of non-empty project-relative paths; never replace them with scalar values or mixed arrays.
6. Run `wiki verify` and repair only issues attributable to the current page.

Do not call a generation provider from MDGraph, overwrite unrelated pages, delete orphaned pages automatically, or treat verification as a prose-quality judgment.

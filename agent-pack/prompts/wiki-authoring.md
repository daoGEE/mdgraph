# Create or update a project Wiki

Use MDGraph to prepare evidence, then author the Markdown after reading the sources.

1. Check the index and existing Wiki status. Refresh stale evidence within the requested maintenance scope.
2. Create a plan or preserve an existing one with `wiki plan --from <plan> --out <next-plan>`. Specify `--wiki-dir` for v1 migration. Review suggested pages, sources, and gaps before adopting changes.
3. For each affected page, obtain `wiki brief`. Use the primary documents, supplementary material, source inspection paths, and Card ownership labels. Resolve stale or unknown evidence before accepting its hash.
4. Preserve correct prose and selected sources. Update `wiki_id`, `evidence_hash`, `source_docs`, and `source_refs` from the reviewed plan. Both source fields are arrays; additional author-selected sources should be added to the plan instead of silently removed.
5. Run `wiki verify`; fix the affected page's maintenance, link, and evidence issues. Do not delete orphaned pages automatically.
6. Execute the key documented user steps and record the revision, commands, results, and limitations separately. Verification does not evaluate prose correctness.

See the [Knowledge Cards and Wiki Workflow](../../docs/EN/Knowledge_Cards_and_Wiki_Workflow.md) guide and the [reusable Wiki authoring skill](../skills/wiki-authoring/SKILL.md) for the full maintenance contract.

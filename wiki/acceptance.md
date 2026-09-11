# Wiki Workflow Acceptance

This record describes the 2026-09-11 validation of source revision `79b8230`. The Wiki prose, reviewed plan, and this record are delivered together in the subsequent documentation commit. All six planned pages were reviewed and updated; the prior Wiki and v1 plan were preserved outside the working tree before editing.

## Maintained deliverable

The v1 plan was migrated with an explicit `wiki` output directory. Existing page IDs, paths, titles, purposes, outlines, and document selections were preserved. The new evidence, dependency, and domain modules were explicitly added to the relevant pages' source selections before refreshing their hashes.

The refreshed repository index contained 38 documents, 317 sections, 262 entities, 26 source refs, and 1,648 edges, with zero skipped files and no embeddings. Every page brief reported fresh index evidence, fresh selected dependencies, and zero evidence gaps. Brief evidence use ranged from 26,109 to 27,985 characters within a 28,000-character budget.

Final status: **6 current, 0 needs update, 0 missing, 0 orphaned**. Verification returned **valid with zero errors and zero warnings**. The machine-readable dependency hashes and results are in `validation/wiki-acceptance.json` in the repository.

`current` means recorded dependencies and maintenance fields match. Verification explicitly reports `contentReview: not-evaluated`; prose review and executed user steps are recorded separately below.

## Executed user steps

A local npm tarball of the validated source revision was installed offline, with lifecycle scripts disabled, into a new consumer directory. These checks used the installed executable on macOS arm64 with Node.js 26.5.0:

| Workflow | Observed result |
|---|---|
| Initialize a new orchard fixture | Configuration and the initial index created successfully |
| Status, search, context, node, trace | All commands succeeded; node returned a bounded Card with readable next steps |
| Modify a source Markdown document | Doctor detected a stale index |
| Reindex and query the new marker | Doctor returned fresh evidence and search found the changed text |
| Create a v2 plan and obtain a brief | Correct Wiki directory and fresh dependency evidence returned |
| Start stdio MCP without watch | Initialization succeeded; exactly five tools were listed |
| Call all five MCP tools | Status, search, context, node, and trace returned successful results |

The command/tool record is in `validation/installed-wiki-workflow.json`. This is an actual local package installation, not a test of the published registry release or a graphical host configuration.

## Automated checks

- Node.js 22.23.2: 41 test files, 199 tests passed.
- Node.js 26.5.0: 41 test files, 199 tests passed.
- The stage 5 tracked-file snapshot built and passed all 199 tests independently of the untracked Wiki.
- Type checking, public documentation links, CLI smoke, retrieval evaluation smoke, and packaged Wiki update/verification smoke passed.
- The final tracked-file delivery snapshot built, checked documentation links, rebuilt its own index, and verified all six Wiki pages as current without using the workspace database.
- Focused regression tests exercise Card evidence ownership, real intermediate nodes, v1/v2 migration, preserved source choices, and the full affected-page update flow while preserving unrelated prose.

## Output comparison

The fixed orchard fixture was measured before (`9cf7a05`) and after the redesign. References lacking ownership labels fell to zero for each target. Each new next-read list placed the expected document first; the old Cards did not have next-read entries, so their rank is recorded as null rather than a search failure.

| Card target | Before JSON characters | After JSON characters | After first expected next-read rank |
|---|---:|---:|---:|
| Timing section | 2,308 | 2,946 | 1 |
| OrchardScheduler entity | 1,002 | 2,298 | 1 |
| Scheduler source reference | 816 | 1,816 | 1 |

Ownership and reading guidance increased output size; all three Cards stayed below 4,000 characters. Reproduce current output with `npm run baseline:knowledge-wiki`. Full measurements and provenance are in `validation/knowledge-wiki-baseline.json`.

For the 500-document synthetic workload, Card median time was 10.71 ms before and 9.38 ms after; context median time was 25.60 ms before and 24.93 ms after. These single local runs do not establish a speedup. They showed no obvious regression under the measured workload; memory observations are post-operation process memory rather than peak allocation.

## Limits

These checks do not establish independent-agent completion-time or prose-quality improvements. No live external embedding provider, Windows runtime, remote CI run, graphical MCP host, or published registry release was exercised in this acceptance. Correct source citations and successful maintenance verification are not a substitute for independent review of every natural-language claim.

# MDGraph Release Checklist

Use this checklist before publishing an MDGraph release or asking a maintainer to cut one. It complements [CHANGELOG.md](../../CHANGELOG.md), [Output_Contracts.md](Output_Contracts.md), [Public_Contracts.md](Public_Contracts.md), and the task public check.

## Public checks

- Confirm the public package is `@daogee/mdgraph`, the installed binary remains `mdgraph`, and `package.json` / CLI versions match the release tag.
- Promote the relevant [CHANGELOG.md](../../CHANGELOG.md) `Unreleased` entries into a dated version whose number matches `package.json` before tagging.
- Review README quick start, requirements, MCP setup, output contracts, public contract labels, and known tradeoffs when public CLI/MCP behavior changed.
- Confirm the GitHub repository still exposes `README.md`, `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, issue templates, and the pull-request template; review the GitHub community profile before a public launch.

## Contract gate

- Confirm [Public_Contracts.md](Public_Contracts.md) labels every touched public surface as `stable`, `stable-additive`, `experimental`, `reserved`, or `internal`.
- Confirm focused contract tests cover MCP tool definitions, representative JSON fields, edge kinds, doctor warning shape, config defaults, and schema compatibility guidance.
- Confirm structured error outputs include a stable `code` and remediation where the command already returns structured errors.
- Confirm experimental commands remain explicitly labeled in the guides, public ledger, output contracts, and release notes.

## Evidence gate

- Confirm [Public_Contracts.md](Public_Contracts.md) labels context recovery fields as `stable-additive`.
- Confirm context, MCP, and contract tests cover `nodeId`, `documentId`, optional `sectionId`, optional `anchor`, and graph-expansion `edgePath`.
- Confirm `smoke:cli` exercises a multi-question structured benchmark using repository-owned fixtures.
- Confirm optional semantic behavior remains experimental unless a separate release explicitly freezes it.
- Run the focused lexical-history, entity, context, structured-query, and derived-relationship regression suites. Treat recorded historical values as immutable comparison evidence, not current product targets.

## Compatibility gate

- Confirm known output-shape inconsistencies are either normalized or intentionally documented.
- Confirm `context --json` and MCP `mdgraph_context.structuredContent` expose recovery fields (`nodeId`, `documentId`, optional `sectionId`, optional `anchor`, and graph-expansion `edgePath`) for agent handoff to `node`, `trace`, and raw Markdown.
- Confirm Node.js `>=22.5.0` remains the supported floor and the active release was tested on the current Node 22.x line.
- Confirm Linux and Windows full CI rows pass. Confirm the macOS CI smoke row passes build-output CLI and packed-artifact smoke.
- Run maintainer smoke for platform-specific long-running surfaces that CI intentionally does not automate: `serve --mcp` and `watch` on each target OS where those paths matter.
- Confirm release notes call out compatibility promises separately from feature additions.
- Confirm new behavior does not silently change the frozen 1.0 defaults, five-tool MCP surface, schema version, or `alpha | cjk` evaluation enum.

## Command gate

Run from the repository root after dependencies are installed:

```bash
npm run typecheck
npm run docs:check
npm run build
npm run test:run
npm run baseline:historical
npm run baseline:entity-extraction
npm run baseline:context-packing
npm run baseline:structured-query
npm run baseline:related-documents
npm run smoke:cli
npm run smoke:eval
npm run smoke:pack
npm run smoke:clean
node dist/bin/mdgraph.js index --json
node dist/bin/mdgraph.js doctor --strict --json
node dist/bin/mdgraph.js status --storage --json
node dist/bin/mdgraph.js bundle create --profile private --json
node dist/bin/mdgraph.js bundle verify BUNDLE_DIR_FROM_CREATE_OUTPUT --json
node dist/bin/mdgraph.js report --json --eval --bundle BUNDLE_DIR_FROM_CREATE_OUTPUT
node dist/bin/mdgraph.js diff --base HEAD --json
node dist/bin/mdgraph.js report --json --base HEAD
node dist/bin/mdgraph.js report --json --benchmark PATH_TO_BENCHMARK_RUN_RECORDS
npm run task:public-check
git diff --check
```

Expected results:

- Documentation links, typecheck, tests, build, focused regression suites, CLI smoke, and pack smoke exit 0.
- `doctor --strict --json` reports `staleIndex: 0` and no issue counts for the MDGraph repository.
- `status --storage --json` returns `{ counts, storage }` with database, object, path group, edge kind, high-degree node, and vector sections.
- `bundle create`, `bundle verify`, and `report --json --eval --bundle` return valid private workflow artifacts for the current repository index.
- `diff --base` and `report --base` return a documentation graph impact summary without replacing the current index.
- `report --benchmark` returns paired run-record deltas for a multi-question smoke set, reports incomplete pairs as skipped, and does not require transcripts or agent/model execution.
- `task:public-check` does not find tracked task artifacts under `docs/tasks/` except the allowed public files.
- `git diff --check` is clean. On Windows CRLF files, set repository-local `core.whitespace=cr-at-eol` if needed to avoid false positives on unchanged CRLF endings.
- Keep private or third-party evaluation corpora outside release artifacts and public fixtures.
- The macOS CI row is smoke-only. It does not replace the full command gate or maintainer checks for MCP server, watcher, and external-corpus behavior.

## Package gate

- Inspect the machine-readable tarball contents whenever package metadata or public docs change: `npm pack --dry-run --json`.
- Confirm npm Trusted Publishing is bound to `daoGEE/mdgraph` and the exact workflow filename `publish.yml`, with the `npm publish` action allowed.
- Publish by pushing a `v*` tag whose version matches `package.json`; `.github/workflows/publish.yml` uses GitHub Actions OIDC and does not require a long-lived npm token.
- Confirm the package includes `dist`, the agent pack, both README files, `CHANGELOG.md`, `LICENSE`, and the explicitly allowlisted English/Chinese guides.
- Confirm the package does not contain numbered implementation-stage docs, internal implementation ADRs, `docs/tasks/`, `.mdgraph/`, local databases, `.DS_Store`, temporary output, or external workspace content.
- Install the packed tarball globally under a clean temporary prefix and verify `mdgraph --version`, `init`, and one representative query before publishing.
- Run `npm run smoke:pack`; it verifies runtime/type consumption and rejects implementation-stage documentation in the tarball.

## Note text

- Summarize user-visible CLI/MCP behavior changes.
- Call out output contract changes explicitly.
- Mention known `node:sqlite` experimental warnings only as non-failing runtime warnings.

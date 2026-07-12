# MDGraph 1.0 Contract Freeze Appendix

Status: active
Created: 2026-07-09
Companion to: [Public_Contracts.md](Public_Contracts.md) and [Output_Contracts.md](Output_Contracts.md)
Task: 2026-06-27-roadmap-1-0-contract-freeze

This appendix is the authoritative inventory of the MDGraph public surface
frozen for the `1.0.0` release. It supplements the [Public Contracts](Public_Contracts.md)
ledger with the full per-command, per-format, per-config, per-schema
details that the ledger summarizes.

The local implementation context lives in
`docs/tasks/2026-06-27-roadmap-1-0-contract-freeze/`, which stays ignored
and is not a GitHub deliverable.

## Freeze Baseline

- Package version: `1.0.0`
- SQLite `schemaVersion`: `1`
- MCP tool surface: exactly the five tools listed below
- New 0.9 additive public surfaces are explicitly labeled `stable-additive`
  in the Public Contracts ledger and validated alongside the 0.7-0.8
  surfaces.

## Stability Labels

Reuse the labels in [Public_Contracts.md](Public_Contracts.md):

- `stable`: required name, required fields, and semantics are frozen.
- `stable-additive`: existing fields and behavior are frozen; new optional
  fields, metrics, or commands may appear when old consumers stay valid.
- `experimental`: visible but not guaranteed for 1.0 compatibility; may
  change with changelog notes and targeted migration guidance.
- `reserved`: named for future use; not active until an emitter or workflow
  is documented and tested.
- `internal`: implementation detail; no compatibility guarantees.

## CLI Freeze Inventory

Each top-level command is frozen at its command path. Required arguments,
options, JSON shape, text shape, and exit behavior are part of the contract.
Human-readable text remains `stable-additive`; JSON shape and exit
semantics are stricter.

| Command | Required args | JSON contract | Text contract | Notes |
|---|---|---|---|---|
| `usage` | none | `usage --json` returns `projectRoot`, `commonOptions`, `workflows` | agent-friendly workflow guide | `stable-additive` |
| `init` | `--docs <glob...>` (or default) | none | init summary | initial graph index by default; `--no-index` is `stable-additive` |
| `index` | none | `index --json` returns `files`, `changed`, `deleted`, `unchanged`, `skipped`, `skippedFiles`, `mode`, `counts` | progress summary | `--semantic` and `--full` are `stable-additive` |
| `status` | none | `status --json` returns graph counts; `--storage` adds `storage`; `--freshness` adds `freshness` | counts summary | `--freshness` is `stable-additive` |
| `search` | `<query>` | `search --json` returns `document`, optional `section`, `score`, `reason`, `content`, `matchedEntities`, optional `semantic`; `--explain` adds `query`, `limit`, `queryMode`, `entityCandidates`, `ftsQuery`, `semanticEnabled`, `semanticActive`, `ranking`, `matchedEntities`, `results` | text list | `--explain`, `--semantic`, `--limit` are `stable-additive` |
| `context` | `<query>` | `context --json` returns `query`, `maxChars`, `usedChars`, `items`; each item carries `nodeId`, `documentId`, optional `sectionId`, optional `anchor`, `path`, `title`, optional `heading`, optional `lines`, `reason`, `matchedEntities`, optional `edgePath` (with `fromId`, `fromLabel`, `edgeFromId`, `edgeToId`, `edgeKind`, `toId`, `toLabel`, `traversalDirection`, `confidence`, `provenance`), optional `sourceRefs`, optional `riskNotes`, and `content`; `--debug` adds `debug` | text context summary | recovery fields are `stable-additive` |
| `node` | `<query>` | `node --json` returns `id`, `label`, `kind`, `data`; `error: "ambiguous_section"` or `error: "not_found"` when unresolved | text node summary | section lookup with anchor is `stable-additive` |
| `trace` | `<from>`, `<to>` | `trace --json` returns `from`, `to`, `found`, `steps` | text trace summary | `--depth` is `stable-additive` |
| `eval` | none | `eval --json` returns `querySet`, `limit`, `ranking`, `generatedAt`, `summary`, `cases` | summary | `--path`, `--query-set`, `--query-mode`, `--limit` are `stable-additive`; `--query-set` accepts the closed enum `alpha | cjk`; `--limit` accepts a positive integer |
| `semantic status` | none | `semantic status --json` returns `state` (closed enum `disabled | not_indexed | ready | unsupported_provider | needs_reindex`), `enabled`, `provider`, `model`, `dimensions`, `providerSupported`, `indexed`, `chunks`, `vectors`, `vectorStorageFormat` (closed enum `float32_blob`), `indexedProviders`, `guidance` | text status | `experimental` |
| `bundle create` | none | `bundle create --json` returns `bundleDir`, `manifestPath`, `manifest` | summary | `--profile` is `experimental`; only `private` is supported; `--path` is `stable-additive` |
| `bundle verify` | `<dir>` | `bundle verify --json` returns `bundleDir`, `valid`, `errors`, `manifest`, `counts`, `schemaVersion`, `sourceHash`, `configHash`, `freshness` | summary | exit non-zero on `valid: false`; `--path` is `stable-additive` for freshness comparison |
| `export graphjson` | none | `export graphjson --json` returns `format: "mdgraph-graphjson"`, `formatVersion: 1`, `schemaVersion`, `mdgraphVersion`, `exportProfile: "structural"`, `graphHash`, `sourceHash`, `counts`, `exportedCounts`, `nodes`, `edges` | structural JSON | `stable` for required v1 fields and privacy exclusions; `--path` is `stable-additive` |
| `export mermaid trace` | `<from>`, `<to>` | `export mermaid trace <from> <to> --json` returns `format: "mdgraph-mermaid"`, `formatVersion: 1`, `diagramType: "trace"`, `found`, `diagram`, `trace` | Mermaid text | `stable-additive` for wrapper fields; `--depth` is `stable-additive` |
| `export markdown-index` | none | none | WikiLink-based Markdown | `stable-additive` for per-document facts; `--path` is `stable-additive` |
| `export docs-site` | none | `export docs-site --json` returns `format: "mdgraph-docsite-index"`, `formatVersion: 1`, `sourceFormat`, `graphHash`, `documents` | summary | `stable-additive` for per-document facts; `--path` is `stable-additive` |
| `export source-bridge` | none | `export source-bridge --json` returns `format: "mdgraph-source-bridge"`, `formatVersion: 1`, `provider`, `status` (closed enum `ready | unsupported`), `reason`, `sourceRefs`, `matched`, `unmatched` | summary | `experimental` for provider semantics; wrapper is `stable-additive`; `--provider` accepts `json`; `--artifact <file>` is required for `status: "ready"` |
| `import graphjson` | `<file>` | `import graphjson <file> --verify --json` returns `valid`, `errors`, `warnings`, plus readable `format`, `formatVersion`, `schemaVersion`, `graphHash`, `counts`, `exportedCounts` | summary | `--verify` is required; exit non-zero on `valid: false`; project root is implicit from the file argument |
| `diff` | none | `diff --base <ref> --json` returns `mode`, `base`, `head`, `summary`, `documents`, `impact` | summary | base index is created in a temp directory |
| `report` | none | `report --json` returns `projectRoot`, `generatedAt`, `mdgraphVersion`, `indexed`, `schema`, `counts`, `storage`, `source`, `doctor`, `eval`, `bundle`, `diff`, `benchmark`, `trend` | summary | optional flags are `experimental` |
| `serve --mcp` | none | not applicable; emits MCP JSON-RPC over stdio | stdio JSON-RPC; stderr logs when watch or MCP debug is enabled | default watch is `stable-additive`; `--no-watch` is the read-only escape hatch |
| `watch` | none | none | progress log | `--semantic` and `--debounce <ms>` are `stable-additive` |
| `doctor` | none | `doctor --json` returns `staleIndex`, `summary` (with `documents`, `orphanDocs`, `deadLinks`, `staleSourceRefs`, `missingDefinitions`, `weaklyLinkedDocs`, `possibleContradictions`, `contentRisks`, `staleIndex`), `issues`, optional `scope` (with `mode`, `baseRef`, `changedPaths`, `deletedPaths`, `renamedPaths`, `untrackedPaths`, `globalHealthIncluded`), optional `health` (with `graph`, `storage`), optional `frontmatterDiagnostics` | summary | `--changed` and `--since <ref>` are `stable-additive`; `--fail-on <severity>` (closed enum `error | warn | info`) exits non-zero at or above severity; `--strict` is the legacy strict mode |

Project-related commands accept an additive `--path <project>` flag so
agents and scripts can target a repository without changing the shell cwd.

## Config Defaults

| Key | Default | Notes |
|---|---|---|
| `docs.include` | `["**/*.md", "**/*.mdx"]` | `**/node_modules/**`, `**/dist/**`, `**/build/**`, `**/.next/**`, `**/coverage/**`, `**/temp/**`, `**/.git/**`, `**/.mdgraph/**` are excluded by default. |
| `docs.exclude` | `[]` (additive on top of built-in excludes) | |
| `index.parseMdx` | `false` | |
| `index.followGitignore` | `true` | |
| `index.maxFileBytes` | `524288` | upper bound `10 MiB` |
| `search.defaultLimit` | `8` | upper bound `100` |
| `search.maxDepth` | `2` | upper bound `12` |
| `search.maxContextChars` | `28000` | upper bound `200000` |
| `search.highFrequencyEntityThreshold` | `50` | upper bound `100000` |
| `entities.enabledKinds` | `["symbol", "api_route", "error_code", "config_key", "file_path", "command", "package", "concept"]` | |
| `entities.stopEntities` | `["Config", "Error", "Service", "API", "User", "Data"]` | noise-suppression list |
| `embedding.enabled` | `false` | optional local semantic vectors |
| `embedding.provider` | `"local-hash"` | `local-hash` is the only fully supported provider |
| `embedding.model` | `"mdgraph-local-hash-v1"` | |
| `embedding.dimensions` | `128` | upper bound `4096` |

Unknown keys are currently ignored by the merge logic. Rejecting unknown
keys is intentionally not a 1.0 breaking change; the conservative default
stays "ignored but not guaranteed" so existing config files keep loading.
Numeric and path-related limits remain part of the safety contract.

## MCP Freeze

The MCP surface stays at exactly five tools:

- `mdgraph_search`
- `mdgraph_context`
- `mdgraph_node`
- `mdgraph_trace`
- `mdgraph_status`

Tool order returned by `tools/list` is part of the contract. Each tool
schema sets `additionalProperties: false`. The initialize root and
per-tool `projectPath` are confined to the served project root.
Text-first content is human-facing; `structuredContent` is the machine
contract.

The frozen MCP input shapes are:

- `mdgraph_search` — required `query`; optional `limit` (positive integer,
  bounded by the `search.defaultLimit` upper bound `100`), `projectPath`.
- `mdgraph_context` — required `query`; optional `knownFiles`
  (string array), `maxChars` (positive integer, bounded by the
  `search.maxContextChars` upper bound `200000`), `projectPath`.
- `mdgraph_node` — required `query`; optional `projectPath`.
- `mdgraph_trace` — required `from`, `to`; optional `depth` (positive
  integer, bounded by the `search.maxDepth` upper bound `12`),
  `projectPath`.
- `mdgraph_status` — optional `projectPath`.

Future optional inputs may be added when old clients remain valid, per
the compatibility policy.

Freshness behavior is part of the 0.9 contract: `mdgraph_status` reports
freshness when indexed, and query tools may prepend a non-blocking
freshness warning plus additive freshness metadata when the index is
stale or unknown. MCP text wording is `experimental`; representative
`structuredContent` fields are `stable-additive`.

Do not add 0.7 export/import surfaces to MCP during the freeze. If agents
later need `mdgraph_export_graphjson`, that should be a separate
public-surface decision.

## JSON Format Freeze

Required top-level fields are frozen; new optional fields are allowed only
where the compatibility policy says `stable-additive`.

- `mdgraph-graphjson`, `formatVersion: 1`, `schemaVersion`,
  `mdgraphVersion`, `exportProfile: "structural"`, `graphHash`,
  `sourceHash`, `counts`, `exportedCounts`, `nodes`, `edges`.
- GraphJSON verify result: `valid`, `errors`, `warnings`, readable
  metadata fields, error `code`, `message`, optional `evidence`, and
  `remediation`.
- `mdgraph-mermaid`, `formatVersion: 1`, `diagramType: "trace"`, `found`,
  `diagram`, `trace`.
- `mdgraph-docsite-index`, `formatVersion: 1`, `sourceFormat`,
  `graphHash`, `documents`.
- `mdgraph-source-bridge`, `formatVersion: 1`, `provider`, `status`
  (closed enum `ready | unsupported`), `reason`, `sourceRefs`, `matched`,
  `unmatched`.

Also freeze the existing core JSON outputs enough for scripts and agents:
`usage`, `status`, `status --freshness`, `search`, `context`, `node`,
`trace`, `doctor`, `semantic status`, `eval`, `diff`, `report`, and
bundle create/verify.

Compatibility rules:

- Removing or renaming a required field is breaking.
- Changing `format` or `formatVersion` semantics requires a new versioned
  contract.
- Adding optional fields is allowed for `stable-additive` objects.
- Unknown future fields in imported JSON may be ignored only when
  required v1 fields remain valid.
- Deterministic exports must keep stable ordering and privacy exclusions.
- `graphHash` changes require either unchanged canonical semantics or an
  explicit version bump.

## Schema Freeze

Schema stability covers MDGraph-owned index compatibility, not third-party
SQL access. The 1.0 contract defines:

- current `schemaVersion: 1` (see `CURRENT_SCHEMA_VERSION` in
  `src/db/connection.ts`)
- required `schema_metadata` keys
- how `schema_migrations` is used
- future-schema refusal before local schema SQL is applied
- migration rules for additive table/column changes
- when a full reindex is required instead of an in-place migration
- the legacy database fallback (`legacy` baseline) for databases created
  before metadata was recorded
- which storage fields are internal and not exported

SQLite table names and columns are stable enough for MDGraph upgrades,
but external tools should consume GraphJSON instead of reading
`.mdgraph/graph.db`.

## Compatibility Policy

- Additive JSON fields are allowed when existing documented fields keep
  their meaning.
- Removing, renaming, or changing the type of a documented stable field
  is breaking after 1.0.
- Optional CLI flags may be added when default behavior is unchanged.
- MCP tool names and required inputs are stable; optional inputs may be
  added when old clients continue to work.
- Unknown future GraphJSON fields may be ignored when required v1 fields
  are valid.
- Unsupported future `formatVersion` values must fail with actionable
  upgrade guidance.
- Error payloads should include a stable `code` and remediation when the
  command already returns structured errors.
- Non-zero exit behavior is part of the contract for failed verification,
  invalid bundle verification, strict doctor gates, and invalid command
  usage.

## Risk Mitigations

- Freezing too much can block necessary 1.x fixes. Mitigation: classify
  exact ranking scores, prose text, and physical SQLite internals as
  non-contractual.
- Freezing too little keeps GraphJSON/MCP consumers exposed to drift.
  Mitigation: protect required JSON fields, MCP tool schemas, and CLI
  command paths with focused contract tests.
- Golden fixtures can become noisy. Mitigation: keep them small,
  fixture-driven, and focused on stable fields instead of whole large
  outputs.
- Schema migration promises can exceed the MVP. Mitigation: freeze
  version/refusal/reindex policy, not arbitrary external SQL compatibility.
- The source bridge is experimental. Mitigation: freeze only the report
  wrapper and unsupported/ready states, not arbitrary third-party schemas.
- Pack or release smoke can be slow in this environment. Mitigation: keep
  pack smoke as release closeout and record exact residual risk when it
  cannot complete.

# MDGraph 公开契约

本文记录当前发布线的公开契约边界，并以冻结的 `1.0.0` 兼容性基线为基础。它补充 [Output_Contracts.md](Output_Contracts.md)、[Architecture.md](Architecture.md) 和 [Release_Checklist.md](Release_Checklist.md)。完整的逐命令、逐格式、逐配置、逐 schema 清单见 [1.0 契约冻结附录](Public_Contracts_1.0.md)。

## 稳定性标签

- `stable`：用户和 agent 可以依赖该形状。允许追加字段；`1.0` 后删除或重命名已记录字段属于破坏性变更。
- `stable-additive`：既有字段和语义稳定；只要旧消费者继续有效，该 surface 可以增加 optional 字段或指标。
- `experimental`：可用但不提供稳定兼容承诺；语义可以随 changelog、必要的 migration guidance 和 focused tests 调整。
- `reserved`：为未来用途保留名称；在 emitter 或 workflow 被记录和测试前不代表已启用。
- `internal`：实现细节，不提供兼容承诺。

## 契约 Ledger

| Surface | 状态 | Owner | 契约 |
|---|---|---|---|
| Package 根 JavaScript/TypeScript exports | experimental | `src/index.ts`、`package.json` | Package 根提供已记录的 ESM 入口和对应 TypeScript 声明。除非其他条目明确冻结其行为或 record shape，否则各 helper export 仍为 experimental。 |
| CLI command names 和已记录 flags | stable | `src/bin/mdgraph.ts` | `usage`、`init`、`index`、`status`、`search`、`context`、`node`、`trace`、`eval`、`semantic status`、`bundle create/verify`、`export`、`import graphjson --verify`、`diff`、`report`、`serve --mcp`、`watch` 和 `doctor`。项目相关命令在适用处支持 additive `--path <project>`。`context` 增加可选 `--packing` 和 `--mmr-lambda`；`serve --mcp` 增加显式 `--watch-poll`；`watch` 增加显式 `--poll`。`status --freshness` 继续为 additive，不改变默认 `status --json` 形状。 |
| 项目级 `--path` for project-related commands | stable-additive | `src/bin/mdgraph.ts` | 项目相关命令（`init`、`index`、`status`、`search`、`context`、`node`、`trace`、`eval`、`semantic status`、`bundle create/verify`、`export`、`import graphjson --verify`、`diff`、`report`、`serve --mcp`、`watch`、`doctor` 和 `usage`）接受 additive `--path <project>` flag，让 agent 和脚本不必切换 shell cwd 即可定位仓库。 |
| `mdgraph usage` 命令 | stable-additive | `src/bin/mdgraph.ts` | `usage` 打印面向 agent 的 workflow guide；`usage --json` 返回同一组 workflows 的机器可读 JSON，且不读写 graph index。 |
| 实验性结构化 `query` 命令 | experimental | `src/query/structured-query.ts`、`src/query/structured-query-executor.ts`、`src/bin/mdgraph.ts` | `query <expression>` 提供有界 typed DSL，覆盖已记录的文档字段、tag、出边、日期、排序/limit 与 doctor health。它支持 `--json` 和 `--path`；不会改变稳定的 `search` 或五工具 MCP surface。 |
| 实验性 `relationships derive` 命令 | experimental | `src/relationships/derive-related.ts`、`src/bin/mdgraph.ts` | 在 freshness、capability、coverage、threshold、独立 evidence、reciprocal top-K 和资源预算全部通过后，基于完整 semantic-model vector 显式派生低权重对称 `RELATED_TO` edge。支持 dry-run，且不会在 index/watch 中自动运行。 |
| `status --freshness` diagnostics | stable-additive | `src/bin/mdgraph.ts` | `status --freshness` 增加可选 freshness diagnostics（`state`、`recommendation`、`lastIndexedAt`、`checkedAt`、`issues`），不改变默认 `status --json` 形状；`--storage` 与 `--freshness` 可组合。 |
| `serve --mcp` 默认 watch 与 `--no-watch` 退路 | stable-additive | `src/bin/mdgraph.ts` | `serve --mcp` 默认保持 Markdown graph fresh，并暴露 `--no-watch` 作为只读退路；`--watch`、`--semantic`、`--debounce <ms>` 和显式 `--watch-poll` 是集成 watch-based freshness 的 additive flag。 |
| 顶层 CLI JSON output shapes | stable | `docs/ZH/Output_Contracts.md` | Output Contracts 中记录的必需字段稳定；命令内嵌 graph record 遵循 `src/types.ts`，除非某一 section（例如实验性结构化 `query` 或 `relationships derive`）另有明确标记。 |
| MCP tool names 和 input schemas | stable | `src/mcp/tools.ts` | 固定五个工具：`mdgraph_search`、`mdgraph_context`、`mdgraph_node`、`mdgraph_trace` 和 `mdgraph_status`；schema 拒绝未声明属性。 |
| MCP structured freshness metadata | stable-additive | `src/mcp/tools.ts` | 当已建立索引时，`mdgraph_status` 会在 `structuredContent` 中返回 `freshness` metadata；当索引 `stale` 或 `unknown` 时，`mdgraph_search` / `mdgraph_context` / `mdgraph_node` / `mdgraph_trace` 也可能追加同一 `freshness` object，并在文本结果前加 warning banner。 |
| MCP semantic fallback diagnostics | stable-additive | `src/mcp/tools.ts` | `mdgraph_search` 和 `mdgraph_context` 使用异步 provider 路径。semantic retrieval 无法运行时继续返回 lexical/graph 结果并在文本前增加 warning。Search 追加 `structuredContent.semanticDiagnostic`；context 追加 `structuredContent.context.semanticDiagnostic`。两者都包含 `code`、`provider`、`message` 和 `degraded: true`。 |
| Context packing 选择 | stable-additive | `src/query/context-builder.ts`、`src/mcp/tools.ts` | 已有调用继续使用 `mmr-style-document-round-robin`。CLI `--packing mmr`、MCP `mdgraph_context.packingStrategy` 和库 options 可选择真 MMR。Context 输出增加 `packing`；debug 输出增加相似度、lambda、selection score 和冗余跳过诊断。 |
| Watch health 与 polling | stable-additive | `src/watcher/file-watcher.ts`、`src/watcher/watch-health.ts`、`src/mcp/tools.ts` | `WatchHandle.getHealth()` 暴露进程内状态、时间、最近错误、覆盖可靠性、polling 和关闭状态。集成 MCP status 可增加 `structuredContent.watchHealth`。只有 `watch --poll`、`serve --mcp --watch-poll` 或 `usePolling: true` 才启用 polling。 |
| Structured query AST 与执行 | experimental | `src/query/structured-query.ts`、`src/query/structured-query-executor.ts`、`src/db/repositories.ts` | 用户值使用 SQL bound parameter。字段、operator、sort 与 edge enum 在白名单 SQL 组装前完成验证。Health predicate 要求 fresh doctor report，并保留原始 boolean AST。不会暴露任意 front matter 或 raw SQL 逃生口。 |
| 派生关系执行 | experimental | `src/relationships/derive-related.ts`、`src/db/repositories.ts` | `RELATED_TO/embedding_similarity` edge 非权威、低权重且可原子替换，并携带 provider/model/algorithm/threshold/evidence/generation metadata。`local-hash` 无权发射。GraphJSON 保持结构化隐私 profile，因此不导出这些 edge metadata。 |
| MCP text output wording | experimental | `src/mcp/tools.ts` | 文本是面向人的提示；机器契约优先使用 `structuredContent`。 |
| Context recovery fields | stable-additive | `src/query/context-builder.ts` | Context item 暴露 `nodeId`、`documentId`、可选 `sectionId`、可选 `anchor`、line range、source refs、risk notes 和 graph-expansion `edgePath`，让 agent 无需从 prose 猜测即可恢复节点和 provenance。 |
| `.mdgraph/config.json` fields | stable | `src/config/load-config.ts` | `docs`、`index`、`search`、`entities` 和 `embedding` 默认字段稳定。Additive embedding 字段为 `endpoint`、`timeoutMs` 和 `batchSize`，既有配置文件会取得默认值。当前 merge 逻辑会忽略未知字段。 |
| `.mdgraph` file governance | stable | `src/config/load-config.ts`、`src/bin/mdgraph.ts` | `mdgraph init` 保持 `.mdgraph/config.json` 可跟踪，在没有等价 ignore 规则时通过根 `.gitignore` 保护本地 `.mdgraph` artifacts，并默认构建初始 graph index。`.mdgraph/graph.db` 和生成的 `.mdgraph` artifacts 属于本地 workflow state，不是 source files。需要只生成配置时使用 `--no-index`。 |
| SQLite schema metadata | stable | `src/db/schema.sql`、`src/db/connection.ts` | `schema_metadata.schema_version` 是兼容 gate。未来 schema version 会在应用本地 schema 前失败。 |
| SQLite table internals | internal | `src/db/schema.sql` | rowid、FTS shadow table、vector blob 表示细节和 private bundle database 内容不是 public API。 |
| Public graph record types | stable | `src/types.ts` | `GraphDocument`、`GraphSection`、`GraphEntity`、`SourceRef`、`GraphEdge`、`GraphChunk`、`ChunkVector`、`SearchResult` 和 `TraceStep`。 |
| Edge kinds | stable/experimental/reserved | `src/types.ts` | 既有显式 edge kind 保持 stable。`RELATED_TO` 是由 `DERIVED_EDGE_KINDS` 标识的实验性 opt-in 派生 kind；`SAME_AS` 和 `CONTRADICTS` 继续 reserved，直到独立 emitter 被记录和测试。 |
| Doctor warning shape | stable | `src/analysis/doctor.ts` | Warning 包含 `code`、`severity`、`message`、`evidence`、`affectedNodes` 和 `remediation`。warning code 通过 changelog 和 tests 管理版本。 |
| GraphJSON export 和 verify | stable format v1 | `src/export/graphjson.ts` | `format: "mdgraph-graphjson"`、`formatVersion: 1`、structural profile、确定性排序和 `graphHash` 验证。 |
| Bundle manifest | experimental | `src/bundle/bundle.ts` | `formatVersion: 1` private workflow artifact。它不是公开 sanitized exchange format。 |
| Report、diff 和 benchmark JSON | experimental | `src/reporting`、`src/diff`、`src/benchmark` | 面向 CI 的 workflow 输出；必需顶层字段已记录，但只要 surface 仍为 experimental，详细 metrics 仍可能扩展。 |
| Semantic vector provider behavior | experimental | `src/semantic/*` | `local-hash` 作为 `lexical-hash` 兼容 provider 保留；Ollama 是第一个可选 `semantic-model` provider。外部 provider 只通过异步 indexing/query API 运行；不可用或不支持时，query 必须带诊断降级到 FTS5/graph search。显式 indexing 失败不得提交部分 graph/vector 更新。 |

## 兼容策略

- 当已有字段语义不变时，允许追加 JSON 字段。
- `1.0` 后删除、重命名或改变已记录 stable 字段类型属于破坏性变更。
- 在默认行为不变时，可以新增 optional CLI flag。
- MCP tool name 和 required input 稳定；新增 optional input 时旧客户端必须继续工作。
- 当必需 v1 字段有效时，可忽略未知 GraphJSON future fields。
- 不支持的未来 `formatVersion` 必须返回可行动的升级 guidance。
- 已经返回结构化错误的命令应提供稳定 `code` 和 remediation。
- verify 失败、bundle verify 无效、strict doctor gate 和非法命令用法的非零退出属于契约。

## Schema And Config 策略

- 没有 metadata 的既有数据库在 metadata table 创建后标记为 `legacy`。
- future `schema_version` 会在本地 schema SQL 应用前失败。
- 当 public graph record 保持兼容时，现有 migration helper 可以更新 storage internals。
- 无法安全迁移的 schema change 必须给出 rebuild 或 upgrade guidance。
- 新 config 字段必须有默认值；除非明确记录为 breaking，否则不能让既有 config 文件失效。
- Config numeric 和 path 相关限制是安全契约，不是可选调参建议。

## Release Matrix

每次发布都必须保留稳定的 1.0 基线，并验证所有 `stable-additive` surface，包括 `usage`、项目级 `--path`、`status --freshness`、MCP freshness metadata、context recovery fields、可选 context packing、watch health 和默认 fresh MCP serving。实验性的 structured query、semantic-provider 与 derived-relationship 行为必须保持明确标记，并由聚焦测试覆盖。

`1.0` candidate release 前：

- 运行 `npm run docs:check`、`npm run typecheck`、focused contract tests、`npm test`、`npm run build`、`npm run smoke:cli`、`npm run smoke:eval`、`npm run smoke:pack`、`npm run task:public-check` 和 `git diff --check`。
- 当 package metadata 或 included public docs 变化时运行 `npm pack --dry-run`。
- 验证 Node.js `>=22.5.0`；常规开发基线是当前 Node 22.x。
- Linux 和 Windows full CI 是 release gate 基线；`1.0` 前 macOS 由 CI smoke 覆盖 build-output CLI 和 packed-artifact 行为。
- 对平台相关的长运行 surface 使用 release maintainer smoke，而不是 CI，例如 `serve --mcp` 和 `watch`。
- 外部语料的评估数据应保留在公开仓库之外，除非它拥有独立许可并被明确采纳为公开 fixture。

## 发布就绪条件

只有满足以下条件后才可以发布：

- 上述 ledger 对每个被触及的 public surface 保持最新。
- 关键 public shape 已由 focused tests 或 smoke gates 保护。
- Experimental 和 internal surface 已在文档中明确标注。
- 已知 output-shape 不一致已经被规范化，或在本次发布中被明确记录为刻意保留。
- Release checklist 能捕获意外 public contract drift。

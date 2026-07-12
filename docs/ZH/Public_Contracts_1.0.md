# MDGraph 1.0 契约冻结附录

状态：active
创建时间：2026-07-09
配套文档：[Public_Contracts.md](Public_Contracts.md) 与 [Output_Contracts.md](Output_Contracts.md)
任务：2026-06-27-roadmap-1-0-contract-freeze

本附录是 `1.0.0` 发布时冻结的 MDGraph public surface 公开契约清单。它为 [Public Contracts](Public_Contracts.md) ledger 提供
逐命令、逐格式、逐配置、逐 schema 的细节补充。

本地实现上下文见 `docs/tasks/2026-06-27-roadmap-1-0-contract-freeze/`，该目录
保持忽略，不作为 GitHub 交付物。

## 冻结基线

- Package version: `1.0.0`
- SQLite `schemaVersion`: `1`
- MCP tool surface: 固定下面五个工具
- 0.9 新增的 additive public surface 在 Public Contracts ledger 中显式标注
  `stable-additive`，与 0.7-0.8 表面一起验证。

## 稳定性标签

复用 [Public_Contracts.md](Public_Contracts.md) 中的标签：

- `stable`：必需名称、必需字段、语义均冻结。
- `stable-additive`：既有字段与行为已冻结；只要旧消费者仍有效，可增加
  optional 字段、metric 或命令。
- `experimental`：可见但不为 1.0 兼容承诺，可能随 changelog 与定向 migration
  guidance 调整。
- `reserved`：为未来保留名称，在 emitter 或 workflow 被记录和测试前不启用。
- `internal`：实现细节，不提供兼容承诺。

## CLI Freeze 清单

每个顶层命令在命令路径上冻结。required arguments、options、JSON shape、text
shape、exit behavior 都是契约的一部分。人可读文本保持 `stable-additive`；JSON
shape 与 exit semantics 更严格。

| 命令 | 必需参数 | JSON 契约 | 文本契约 | 备注 |
|---|---|---|---|---|
| `usage` | none | `usage --json` 返回 `projectRoot`、`commonOptions`、`workflows` | 面向 agent 的 workflow guide | `stable-additive` |
| `init` | `--docs <glob...>`（或默认） | none | init summary | 默认构建初始 graph index；`--no-index` 是 `stable-additive` |
| `index` | none | `index --json` 返回 `files`、`changed`、`deleted`、`unchanged`、`skipped`、`skippedFiles`、`mode`、`counts` | 进度 summary | `--semantic` 与 `--full` 是 `stable-additive` |
| `status` | none | `status --json` 返回 graph counts；`--storage` 追加 `storage`；`--freshness` 追加 `freshness` | counts summary | `--freshness` 是 `stable-additive` |
| `search` | `<query>` | `search --json` 返回 `document`、可选 `section`、`score`、`reason`、`content`、`matchedEntities`、可选 `semantic`；`--explain` 追加 `query`、`limit`、`queryMode`、`entityCandidates`、`ftsQuery`、`semanticEnabled`、`semanticActive`、`ranking`、`matchedEntities`、`results` | 文本列表 | `--explain`、`--semantic`、`--limit` 是 `stable-additive` |
| `context` | `<query>` | `context --json` 返回 `query`、`maxChars`、`usedChars`、`items`；每个 item 含 `nodeId`、`documentId`、可选 `sectionId`、可选 `anchor`、`path`、`title`、可选 `heading`、可选 `lines`、`reason`、`matchedEntities`、可选 `edgePath`（含 `fromId`、`fromLabel`、`edgeFromId`、`edgeToId`、`edgeKind`、`toId`、`toLabel`、`traversalDirection`、`confidence`、`provenance`）、可选 `sourceRefs`、可选 `riskNotes`、`content`；`--debug` 追加 `debug` | 文本 context summary | recovery fields 是 `stable-additive` |
| `node` | `<query>` | `node --json` 返回 `id`、`label`、`kind`、`data`；未解析时返回 `error: "ambiguous_section"` 或 `error: "not_found"` | 文本 node summary | 带 anchor 的 section 查找是 `stable-additive` |
| `trace` | `<from>`, `<to>` | `trace --json` 返回 `from`、`to`、`found`、`steps` | 文本 trace summary | `--depth` 是 `stable-additive` |
| `eval` | none | `eval --json` 返回 `querySet`、`limit`、`ranking`、`generatedAt`、`summary`、`cases` | summary | `--path`、`--query-set`、`--query-mode`、`--limit` 是 `stable-additive`；`--query-set` 接受封闭枚举 `alpha | cjk`；`--limit` 接受正整数 |
| `semantic status` | none | `semantic status --json` 返回 `state`（封闭枚举 `disabled | not_indexed | ready | unsupported_provider | needs_reindex`）、`enabled`、`provider`、`model`、`dimensions`、`providerSupported`、`indexed`、`chunks`、`vectors`、`vectorStorageFormat`（封闭枚举 `float32_blob`）、`indexedProviders`、`guidance` | 文本 status | `experimental` |
| `bundle create` | none | `bundle create --json` 返回 `bundleDir`、`manifestPath`、`manifest` | summary | `--profile` 是 `experimental`；仅支持 `private`；`--path` 是 `stable-additive` |
| `bundle verify` | `<dir>` | `bundle verify --json` 返回 `bundleDir`、`valid`、`errors`、`manifest`、`counts`、`schemaVersion`、`sourceHash`、`configHash`、`freshness` | summary | `valid: false` 时非零退出；`--path` 是 `stable-additive`，用于 freshness 比较 |
| `export graphjson` | none | `export graphjson --json` 返回 `format: "mdgraph-graphjson"`、`formatVersion: 1`、`schemaVersion`、`mdgraphVersion`、`exportProfile: "structural"`、`graphHash`、`sourceHash`、`counts`、`exportedCounts`、`nodes`、`edges` | structural JSON | 必需 v1 字段与隐私边界为 `stable`；`--path` 是 `stable-additive` |
| `export mermaid trace` | `<from>`, `<to>` | `export mermaid trace <from> <to> --json` 返回 `format: "mdgraph-mermaid"`、`formatVersion: 1`、`diagramType: "trace"`、`found`、`diagram`、`trace` | Mermaid text | wrapper 字段为 `stable-additive`；`--depth` 是 `stable-additive` |
| `export markdown-index` | none | none | WikiLink Markdown | 文档事实为 `stable-additive`；`--path` 是 `stable-additive` |
| `export docs-site` | none | `export docs-site --json` 返回 `format: "mdgraph-docsite-index"`、`formatVersion: 1`、`sourceFormat`、`graphHash`、`documents` | summary | 文档事实为 `stable-additive`；`--path` 是 `stable-additive` |
| `export source-bridge` | none | `export source-bridge --json` 返回 `format: "mdgraph-source-bridge"`、`formatVersion: 1`、`provider`、`status`（封闭枚举 `ready | unsupported`）、`reason`、`sourceRefs`、`matched`、`unmatched` | summary | provider 语义为 `experimental`；wrapper 为 `stable-additive`；`--provider` 接受 `json`；`--artifact <file>` 在 `status: "ready"` 时必需 |
| `import graphjson` | `<file>` | `import graphjson <file> --verify --json` 返回 `valid`、`errors`、`warnings`，以及可读的 `format`、`formatVersion`、`schemaVersion`、`graphHash`、`counts`、`exportedCounts` | summary | `--verify` 必需；`valid: false` 时非零退出；project root 由文件参数隐式决定 |
| `diff` | none | `diff --base <ref> --json` 返回 `mode`、`base`、`head`、`summary`、`documents`、`impact` | summary | base index 在临时目录中创建 |
| `report` | none | `report --json` 返回 `projectRoot`、`generatedAt`、`mdgraphVersion`、`indexed`、`schema`、`counts`、`storage`、`source`、`doctor`、`eval`、`bundle`、`diff`、`benchmark`、`trend` | summary | 可选 flags 为 `experimental` |
| `serve --mcp` | none | 不适用；通过 stdio 发送 MCP JSON-RPC | stdio JSON-RPC；watch 或 MCP debug 开启时记录到 stderr | 默认 watch 为 `stable-additive`；`--no-watch` 是只读退路 |
| `watch` | none | none | 进度日志 | `--semantic` 与 `--debounce <ms>` 是 `stable-additive` |
| `doctor` | none | `doctor --json` 返回 `staleIndex`、`summary`（含 `documents`、`orphanDocs`、`deadLinks`、`staleSourceRefs`、`missingDefinitions`、`weaklyLinkedDocs`、`possibleContradictions`、`contentRisks`、`staleIndex`）、`issues`，可选 `scope`（含 `mode`、`baseRef`、`changedPaths`、`deletedPaths`、`renamedPaths`、`untrackedPaths`、`globalHealthIncluded`）、可选 `health`（含 `graph`、`storage`）、可选 `frontmatterDiagnostics` | summary | `--changed` 与 `--since <ref>` 是 `stable-additive`；`--fail-on <severity>`（封闭枚举 `error | warn | info`）在不低于该严重级时非零退出；`--strict` 是旧严格模式 |

项目相关命令接受 additive `--path <project>` flag，让 agent 和脚本不必切换
shell cwd 即可定位仓库。

## 配置默认值

| Key | Default | 备注 |
|---|---|---|
| `docs.include` | `["**/*.md", "**/*.mdx"]` | 默认排除 `**/node_modules/**`、`**/dist/**`、`**/build/**`、`**/.next/**`、`**/coverage/**`、`**/temp/**`、`**/.git/**`、`**/.mdgraph/**`。 |
| `docs.exclude` | `[]`（在 built-in exclude 之上叠加） | |
| `index.parseMdx` | `false` | |
| `index.followGitignore` | `true` | |
| `index.maxFileBytes` | `524288` | 上限 `10 MiB` |
| `search.defaultLimit` | `8` | 上限 `100` |
| `search.maxDepth` | `2` | 上限 `12` |
| `search.maxContextChars` | `28000` | 上限 `200000` |
| `search.highFrequencyEntityThreshold` | `50` | 上限 `100000` |
| `entities.enabledKinds` | `["symbol", "api_route", "error_code", "config_key", "file_path", "command", "package", "concept"]` | |
| `entities.stopEntities` | `["Config", "Error", "Service", "API", "User", "Data"]` | 噪声抑制列表 |
| `embedding.enabled` | `false` | 可选本地 semantic vectors |
| `embedding.provider` | `"local-hash"` | 仅 `local-hash` 是完全受支持的 provider |
| `embedding.model` | `"mdgraph-local-hash-v1"` | |
| `embedding.dimensions` | `128` | 上限 `4096` |

未知 key 当前由 merge 逻辑忽略。1.0 不强制将未知 key 变为错误；保持"忽略但不
承诺"的保守默认，使既有 config 文件继续加载。数值与路径相关限制仍属于安全
契约的一部分。

## MCP 冻结

MCP surface 保持固定为五个工具：

- `mdgraph_search`
- `mdgraph_context`
- `mdgraph_node`
- `mdgraph_trace`
- `mdgraph_status`

`tools/list` 返回的工具顺序属于契约的一部分。每个工具 schema 设置
`additionalProperties: false`。initialize root 和每个工具的 `projectPath` 必须
位于 served project root 内。text-first content 面向人；机器契约优先使用
`structuredContent`。

冻结的 MCP 输入形状为：

- `mdgraph_search` — 必需 `query`；可选 `limit`（正整数，受 `search.defaultLimit`
  上限 `100` 约束）、`projectPath`。
- `mdgraph_context` — 必需 `query`；可选 `knownFiles`（字符串数组）、`maxChars`
  （正整数，受 `search.maxContextChars` 上限 `200000` 约束）、`projectPath`。
- `mdgraph_node` — 必需 `query`；可选 `projectPath`。
- `mdgraph_trace` — 必需 `from`、`to`；可选 `depth`（正整数，受 `search.maxDepth`
  上限 `12` 约束）、`projectPath`。
- `mdgraph_status` — 可选 `projectPath`。

根据兼容性策略，后续可以在保持旧客户端可用的前提下追加 optional inputs。

freshness 行为是 0.9 契约的一部分：`mdgraph_status` 在已建立索引时报告
freshness；查询工具在索引 `stale` 或 `unknown` 时可以前置非阻塞的 freshness
warning 并附加 additive freshness metadata。MCP 文本措辞为 `experimental`；
代表性 `structuredContent` 字段为 `stable-additive`。

1.0 冻结期间不向 MCP 添加 0.7 export/import surface。如果未来 agent 需要
`mdgraph_export_graphjson`，应作为单独的 public-surface 决策。

## JSON 格式冻结

required top-level fields 冻结；新增 optional fields 仅在兼容性策略标注
`stable-additive` 时允许。

- `mdgraph-graphjson`、`formatVersion: 1`、`schemaVersion`、
  `mdgraphVersion`、`exportProfile: "structural"`、`graphHash`、
  `sourceHash`、`counts`、`exportedCounts`、`nodes`、`edges`。
- GraphJSON verify 结果：`valid`、`errors`、`warnings`、可读的 metadata 字段、
  错误 `code`、`message`、可选 `evidence` 与 `remediation`。
- `mdgraph-mermaid`、`formatVersion: 1`、`diagramType: "trace"`、`found`、
  `diagram`、`trace`。
- `mdgraph-docsite-index`、`formatVersion: 1`、`sourceFormat`、`graphHash`、
  `documents`。
- `mdgraph-source-bridge`、`formatVersion: 1`、`provider`、`status`（封闭
  枚举 `ready | unsupported`）、`reason`、`sourceRefs`、`matched`、`unmatched`。

同时冻结既有核心 JSON 输出，足以支撑脚本与 agent：`usage`、`status`、
`status --freshness`、`search`、`context`、`node`、`trace`、`doctor`、
`semantic status`、`eval`、`diff`、`report` 以及 bundle create/verify。

兼容性规则：

- 删除或重命名必需字段属于破坏性变更。
- 修改 `format` 或 `formatVersion` 语义需要新的版本化契约。
- `stable-additive` 对象允许追加 optional 字段。
- 当必需 v1 字段有效时，可忽略未来未知字段。
- 确定性导出必须保持稳定排序与隐私边界。
- `graphHash` 变化要么保持一致的规范语义，要么显式版本升级。

## Schema 冻结

Schema 稳定性覆盖 MDGraph 自有 index 兼容性，而非第三方 SQL 访问。1.0 契约
定义：

- 当前 `schemaVersion: 1`（参见 `src/db/connection.ts` 中的
  `CURRENT_SCHEMA_VERSION`）
- 必需的 `schema_metadata` keys
- `schema_migrations` 的使用方式
- 在应用本地 schema SQL 前拒绝未来 schema
- 表/列的 additive 变更迁移规则
- 何时需要 full reindex 而非原地迁移
- 旧数据库的回退（`legacy` baseline，针对尚未记录 metadata 的数据库）
- 哪些 storage 字段是 internal 而不导出

SQLite 表名与列名对 MDGraph 升级足够稳定，但外部工具应消费 GraphJSON 而
不是读取 `.mdgraph/graph.db`。

## 兼容策略

- 当已有字段语义不变时，允许追加 JSON 字段。
- 1.0 后删除、重命名或改变已记录 stable 字段类型属于破坏性变更。
- 默认行为不变时，可新增 optional CLI flag。
- MCP 工具名与必需 input 稳定；旧客户端可继续工作时允许新增 optional input。
- 必需 v1 字段有效时，可忽略未知未来 GraphJSON 字段。
- 不支持的未来 `formatVersion` 必须返回可操作的升级 guidance。
- 已返回结构化错误的命令应包含稳定 `code` 与 remediation。
- verify 失败、bundle verify 无效、strict doctor gate 与非法命令用法的非零
  退出属于契约的一部分。

## 风险缓解

- 过度冻结会阻碍必要的 1.x 修复。缓解：将精确 ranking score、prose 文本和
  物理 SQLite 内部标记为非契约。
- 冻结过少会让 GraphJSON/MCP 消费者暴露在 drift 中。缓解：用 focused
  contract tests 保护必需 JSON 字段、MCP tool schema 和 CLI command path。
- Golden fixtures 可能变得嘈杂。缓解：保持小型化、fixture 驱动，仅覆盖
  稳定字段而非整份大输出。
- Schema migration 承诺可能超出 MVP。缓解：冻结版本/拒绝/reindex 策略，
  而非任意外部 SQL 兼容性。
- source bridge 仍是 experimental。缓解：仅冻结 report wrapper 与
  unsupported/ready 状态，不冻结任意第三方 schema。
- Pack 或 release smoke 在当前环境可能较慢。缓解：将 pack smoke 保留为
  release closeout，并在不能完成时记录精确的残余风险。

# MDGraph 架构

MDGraph 采用以下已实现的流水线：扫描器 → 解析器 → 提取/解析器 → SQLite 存储 → 查询引擎 → CLI/MCP。

## 模块映射

| 区域 | 路径 | 职责 |
|---|---|---|
| CLI | `src/bin/mdgraph.ts` | init、index、status、search、context、node、trace、eval、diff、bundle、report、export、import、semantic status、serve、watch 和 doctor 命令。 |
| 配置 | `src/config/load-config.ts` | 默认配置、`.mdgraph/config.json` 创建和安全配置合并。 |
| 扫描器 | `src/scanner/file-scanner.ts` | 使用 include/exclude 通配符和最大文件大小限制查找 Markdown 文件。 |
| 解析器 | `src/parser/*` | 前置元数据、Markdown AST、标题、代码块、行内代码、Markdown 链接和 WikiLink。 |
| 提取 | `src/extraction/*` | 将解析后的文档转换为图记录和确定性的实体/边信号。 |
| 解析 | `src/resolution/link-resolver.ts` | 将 Markdown 和 WikiLink 目标解析为已索引的文档或章节。 |
| 存储 | `src/db/*` | SQLite 连接、模式、记录替换、增量更新、图查询和存储诊断。 |
| 查询 | `src/query/*` | 搜索排序、上下文打包、图追踪，以及实验性结构化查询 tokenizer/AST/executor。 |
| 评估 | `src/evaluation/*` | 检索评估 case、期望记录，以及 search/context/trace 质量的轻量指标。 |
| Benchmark | `src/benchmark/*` | 结构化 with/without-MDGraph agent run record 解析和 paired delta 聚合。 |
| Bundle | `src/bundle/*` | 基于 schema/source/config/document hashes 的私有目录图 bundle 创建和校验。 |
| Reporting | `src/reporting/*` | 面向 CI 的图工作流报告，聚合 counts、storage、doctor、eval、bundle、diff 和 benchmark summary。 |
| Diff | `src/diff/*` | 基于 Git base ref 的文档图 diff 和 PR impact summary 生成。 |
| Export/Import | `src/export/*` | 确定性 GraphJSON、Mermaid、Markdown/docs-site 和只读 source bridge adapter。 |
| 语义 | `src/semantic/*` | 可插拔 embedding provider、兼容用 `local-hash`、可选 Ollama 集成、Float32 向量编解码、provider 诊断和余弦评分。 |
| MCP | `src/mcp/*` | 基于换行符分隔的 JSON-RPC MCP 服务器和工具处理器。 |
| 监听 | `src/watcher/file-watcher.ts`、`src/watcher/watch-health.ts` | 通过 chokidar 实现防抖增量重新索引，并维护进程内持久健康分类。 |
| 分析 | `src/analysis/doctor.ts` | 文档健康和治理报告。 |

## 公开契约边界

公开契约边界记录在 [Public_Contracts.md](Public_Contracts.md)。简要来说，CLI command names 和已记录 flags、顶层 CLI JSON fields、MCP tool names 和 input schemas、已记录 config fields、GraphJSON format v1、public graph record types、已启用 edge kinds 和 doctor warning shape 属于 public surfaces。SQLite rowid、FTS shadow table、private bundle database internals、临时路径和实现 helper API 属于 internal。

## 数据模型

SQLite 数据库存储在 `.mdgraph/graph.db`，由 `src/db/schema.sql` 创建。

主要记录：

- `documents`：每篇 Markdown 文档一行，包含路径、哈希值、状态、类型、信任层级和元数据。
- `schema_metadata`：记录当前 schema version、MDGraph 版本来源、更新时间以及 `current`/`legacy` baseline 的 key/value metadata。
- `schema_migrations`：为未来真实 schema migration 预留的审计表。
- `sections`：标题边界的文档区域，带有锚点和源行范围。章节内容在下一个任意层级标题前结束；父子上下文通过图关系恢复，而不是在 chunk 文本中重复。
- `entities`：符号、API 路由、错误码、配置键、文件路径、命令、包和概念。
- `source_refs`：文档引用的源/配置/脚本路径。
- `edges`：图关系，包含类型、置信度、权重、来源和元数据。
- `chunks`：由章节内容生成、用于搜索和上下文打包的文本块。
- `chunks_fts`：用于关键词搜索的 FTS5 索引。CJK 文本只在 FTS 索引内容中追加轻量 n-gram token。
- `chunk_vectors`：按块键控、以 Float32 BLOB 行存储的可选本地语义向量。

## 索引流程

1. `scanMarkdownFiles` 从配置中选择候选 Markdown 文件。
2. `parseMarkdownDocument` 读取前置元数据和 Markdown 结构。
3. `buildGraphRecords` 同步创建确定性的文档、章节、实体、源引用、块和边。
4. embedding 启用时，`indexProject` 解析 `EmbeddingProvider`；新索引或 provider profile 变化时异步嵌入全部 chunks，profile 匹配的增量索引只嵌入 changed chunks。
5. `GraphRepository.replaceAll` 写入完整重建，或 `replaceDocuments` 更新已更改/已删除的文档及其 vectors。
6. `indexProject` 比较已存储 hash 与 vector profile coverage，选择全量或增量模式。

向量生成会在 repository write 开始前全部完成，因此 provider 失败时旧 graph 保持不变，不会提交部分 vector coverage。增量模式会删除已更改和已移除文件的文档派生记录，移除对应 FTS 词项，重新插入已更改的记录，并在清理后修剪未引用的全局实体/源引用。完整重建会 optimize 并 vacuum SQLite 数据库，避免旧 FTS 页面和已删除行继续放大磁盘文件。

## 派生关系流程

`relationships derive` 是显式 post-index workflow，不属于普通 indexing 或 watch mode。它要求 doctor content-hash/ID freshness 审计通过且没有 parse failure、已配置的 `semantic-model` provider，以及当前 provider/model/dimensions 的完整 vector coverage；`local-hash` 会被拒绝。实现会有界采样文档 chunk，使用归一化 document centroid 过滤候选，要求多组独立高相似度 section pair，并只保留 reciprocal top-K neighbor。

通过门禁的文档对会变成两条对称、低权重的 `RELATED_TO` edge，使用 `embedding_similarity` provenance；metadata 包含 provider/model identity、algorithm/gate version、threshold、evidence section ID 和 generation time。替换是原子的。Incremental indexing 会删除连接 changed/deleted document 的派生 edge；full rebuild 会删除整个可选层。工作流、安全预算和生命周期见[结构化查询与派生关系](Structured_Query_and_Relationships.md#派生相关文档关系)。

派生 edge 可以参与 graph retrieval、trace 和 structured edge predicate，但会从 doctor orphan/weak-link 的权威链接计数中排除，避免推断结果掩盖缺失的维护链接。

## 实体抽取

`extractEntities` 是确定性、source-aware 的实现。显式 front matter 和 `Defines` 章节创建 definition。普通正文只发射 API route、error code 和形状明确的 config key 等高结构 reference，不会提升宽泛的 PascalCase 单词。独立 inline code 可以识别完整的 Latin/CJK symbol；fenced code 中的裸 symbol 则限制在声明和类型引用上下文。Unicode-aware pattern 覆盖 CJK API path、分段 config key 和 function identifier；route 边界避免从 file path 中截取伪 route。

`entities.stopEntities` 会抑制所有 entity kind 的推断 reference，而作者显式声明的 definition 继续保持权威性。这一层是可解释的启发式规则，不是通用 NER 或源码语言 AST。信号策略和边界见[检索与上下文](Retrieval_and_Context.md#确定性实体抽取)。

## 存储诊断

`GraphRepository.storageDiagnostics` 支撑 `mdgraph status --storage`。它报告 SQLite 页数、freelist、journal/WAL checkpoint 状态、`dbstat` 可用时的表/索引/FTS shadow 对象大小、按路径分组的内容贡献、边类型分布、高度数节点、向量存储格式和向量 provider 计数。

该报告是只读可观察性信息。它不会改变图边，也不会变成 doctor warning。当存储增长异常时，用户应先检查 include/exclude globs 以及生成物、依赖和临时目录；需要重建并通过 `VACUUM` 压缩文件时运行 `mdgraph index --full`。

## Schema Metadata 与工作流 Artifact

`openDatabase` 会应用当前 schema 并记录 schema metadata。由当前 CLI 创建的数据库会标记为 `current` baseline；已经存在但缺少 metadata 的旧数据库会在创建 metadata 表后标记为 `legacy`。如果数据库已经声明未来 schema version，MDGraph 会在应用本地 schema SQL 之前拒绝打开，避免静默降级新版图数据。

`createGraphBundle` 会在 `.mdgraph/bundles/private/` 下写入私有目录 bundle。bundle 包含 SQLite 图、配置快照、manifest 和 storage/status 报告。manifest 记录 schema version、MDGraph version、图计数、可用时的 Git provenance、规范化 config hash，以及由按路径排序的文档 path/hash 记录生成的 source hash。它刻意不包含 Markdown 正文和绝对项目根目录。

`verifyGraphBundle` 是只读校验。它检查 manifest 形状、bundle 内数据库可读性、schema version、counts、source/config/document hashes、report hashes，以及在可获得项目根目录时与当前工作区比较 freshness。

`generateReport` 从当前索引生成适合 CI 使用的 JSON 报告。它聚合 schema metadata、counts、storage diagnostics、source hashes、doctor summaries、可选 eval metrics、可选 bundle verification、可选 graph diff、可选 paired benchmark summary，以及显式 previous-report 状态。它不会持久化隐藏的 report history。

## Graph Diff

`generateGraphDiff` 支持面向 PR 的 `diff --base <ref>` 路径。它解析 base Git revision，把 tracked files 复制到临时目录，在其中写入当前 MDGraph config，索引这个临时 base project，然后把 base graph snapshot 与当前 graph index 比较。

Diff report 包含 Markdown 文档新增、修改、删除、Git 识别的 rename、section/source-ref/edge count delta、doctor warning-code delta、变更 source refs、affected document paths，以及简短 PR summary。Base index 隔离在 OS 临时目录中，报告后会删除。Diff 不检查源码 AST，不推断运行时代码影响，也不会替换当前 `.mdgraph/graph.db`。

## 互操作

`buildGraphJsonExport` 从当前索引生成版本化的 `mdgraph-graphjson` 结构导出。它包含 documents、sections、entities、source refs，以及端点都存在于该结构化节点集合中的 edges。导出保留完整 repository `counts` 以便和 status 对齐，并额外提供 `exportedCounts` 来说明省略 chunk/vector/content 后的实际导出规模。该导出刻意不包含 chunk content、section content、vectors、SQLite 内部细节或绝对项目根目录。

`verifyGraphJsonExport` 校验 GraphJSON 形状、受支持的 format version、counts、edge endpoints 和 `graphHash`，不打开或写入本地项目数据库。因此 `import graphjson --verify` 是检查路径，不是 merge import。

`formatTraceMermaid` 把已有 `traceNodes` 结果渲染为确定性 Mermaid。Markdown/docs-site export 基于 GraphJSON 事实生成 adapter 数据，不运行站点生成器。通用 JSON source bridge 读取显式传入的 MDGraph artifact 并返回 source-ref 匹配摘要，但不会创建 graph edges，也不会影响 indexing、query ranking、context packing 或 MCP 工具。

## 查询流程

`searchGraph` 结合并去重以下内容：

- FTS5 块命中，包含连续中文/日文/韩文文本的轻量 CJK n-gram 命中。
- 精确实体匹配。
- 可选 embedding 向量匹配。
- 匹配实体周围的图邻居。

当同一文档或章节通过多条路径命中时，搜索会在 definition、FTS 和可选 semantic 通道之间应用 reciprocal rank fusion（RRF），再保留最高基础分，同时合并主要命中原因和匹配实体，避免丢失来源解释。每个融合结果都会保留可解释的 `RRF fusion (...)` reason。

同步 `searchGraph`、`buildContext` 和 `evaluateRetrieval` API 保留 1.0 行为，可在进程内执行 `local-hash`。对应的异步 API 会解析 Ollama 等外部 provider，CLI 与 MCP 查询路径使用异步版本。provider 不可用、超时、响应非法、模型缺失或 vector coverage 不完整时，会降级到 keyword/entity/graph retrieval，并返回 additive `semanticDiagnostic`；CLI 文本和非 explain JSON 命令还会把诊断写到 stderr。

然后 `buildContext` 从排序后的搜索章节开始，通过非包含边执行有界图扩展，在字符预算下打包选定的章节，并包含原因，如 FTS 命中、语义命中、精确实体匹配或图边遍历路径。兼容默认策略按文档轮询排序候选。可选 `mmr` 最大化 query relevance 并惩罚冗余；两个候选都有当前 provider 已存向量时使用向量相似度，否则回退到确定性的 Unicode token Jaccard，并剪除同文档近重复项，同时保留每个文档的首个候选。

每个 context 结果都会包含 additive packing metadata。当请求 `context --debug` 时，上下文构建还会报告 seed nodes、visited nodes、expanded edges、跳过原因、候选数量、策略/相似度选择、逐项 query relevance、redundancy penalty 和 MMR score、冗余剪枝及预算截断计数。这些诊断不是图事实，只用于解释上下文打包和评估检索质量。

实验性结构化查询路径与自然语言 search 分离。`structured-query.ts` 对有界输入进行 tokenize，并校验 typed boolean AST。`GraphRepository` 从 closed field/operator set 把文档、tag、日期和 outgoing-edge predicate 编译为参数化 SQLite operation。除非 AST 包含 doctor 派生 health predicate，否则 `structured-query-executor.ts` 使用直接 SQL 路径；health query 会把参数化原子 document-id set 与 fresh doctor report 合并，再对原始 boolean tree 求值。索引时会把源文件 mtime 写入已有 `documents.updated_at` 列，因此日期治理查询无需 schema migration。

`evaluateRetrieval` 与 `evaluateRetrievalAsync` 会针对已索引项目运行仓库自有的 alpha 或 CJK evaluation cases。它们复用对应的 search/context 路径和 `traceNodes`，并报告预期文档召回、预期章节召回、上下文精度、trace 成功率、延迟、返回字符预算、上下文多样性、reason 覆盖率、RRF 通道、query mode、可选语义 reranker 状态和异步 provider 诊断。evaluation 输出是度量辅助，不是学习式 ranking model，也不能替代聚焦回归测试。

`generateBenchmarkReport` 只消费结构化 `AgentRunRecord` JSON。它按 `questionId` 配对一个 `with_mdgraph` 和一个 `without_mdgraph` record，将不完整或重复 pair 报告为 skipped，并计算 file reads、searches、tool calls、MDGraph calls、字符/token 预算、延迟、raw-file fallback 和引用正确率 delta。它不解析 transcript、不调用模型，也不托管 agent run。

`traceNodes` 在执行节点之间的有界图遍历，并返回每一步的边类型、来源和置信度。

## MCP 边界

MCP 服务器有意仅暴露五个工具。Search/context 通过 provider-aware 异步 handler 调度，node/trace/status 保留同步行为。工具输出以文本为主且兼容 JSON，以便代理可以直接使用，无需先检查 SQLite 数据库或读取原始文件。semantic 降级会增加文本提示和结构化诊断，但不会把仍然可用的 lexical/graph 结果变成 MCP error。服务器会绑定到项目根：initialize root 和工具 `projectPath` 必须位于服务根之内。

## 当前权衡

- `local-hash` 为兼容保留，仍是确定性的词法 feature hash，并非语言模型 embedding。Ollama 是第一个可选 `semantic-model` provider，需要单独运行本地服务和模型。不支持或不可用的 provider 会降级到 FTS5 和 graph search；`semantic status` 会报告 capability、runtime availability、vector coverage、存储格式和重新索引指引。
- 结构化 `query` 是 experimental，覆盖已记录的存储字段、tags、outgoing edges 和选定的 doctor health 类型。任意 front matter key、incoming-edge predicate、aggregation、join 和 MCP structured filter 不属于当前实现。
- 监听模式在文件更改时更新 SQLite，并保留 `starting | healthy | degraded | failed` 健康状态、最近成功索引、最近错误和覆盖可靠性。启动注册错误是 fatal；索引错误可在后续成功索引后恢复；运行期资源失败在重启前保持 degraded。集成 MCP 通过 `mdgraph_status` 暴露快照。原生事件仍是默认值，`watch --poll` 和 `serve --mcp --watch-poll` 是显式的较高成本 fallback。
- Doctor 检查是基于规则的警告。它们会先比较当前文件与索引中的文档 hash 和 id；陈旧索引会返回只读的新鲜度诊断，而不是混合时态的健康结论。
- 存储诊断通过 `status --storage` 暴露；它们不是图事实，也不会扩展 MCP 工具面。
- 私有 bundle artifact 是本地工作流 artifact，不是公开导出。公开安全脱敏和 zip packaging 不属于当前实现。
- Benchmark report 只来自显式结构化 records 的聚合度量；完整 transcript、hosted analytics 和 agent runtime capture 不属于 MDGraph。
- 互操作 adapter 是只读导向的。GraphJSON verify、Mermaid/Markdown/docs-site export 和 source bridge report 不会把外部 graph 合并进主 SQLite index。
- `RELATED_TO` 是实验性派生 edge，只能由显式、provider-gated 的流程发射，普通确定性 indexing 永远不会发射它。`SAME_AS` 和 `CONTRADICTS` 继续保留；类似矛盾的信号仍由 `doctor` 报告，而不是作为 graph edge 插入。
- 当前实现优先考虑紧凑、确定性的核心，而非广泛的 Markdown/MDX 方言支持。

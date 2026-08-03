---
title: 检索与上下文
type: guide
status: active
source_refs:
  - src/query/search.ts
  - src/query/context-builder.ts
  - src/extraction/entity-extractor.ts
  - src/semantic/provider.ts
  - src/semantic/ollama-provider.ts
---

# 检索与上下文

MDGraph 默认组合确定性的全文、实体与图检索。真实 embedding provider 和真正的 Maximal Marginal Relevance（MMR）上下文打包均可显式启用，但索引和查询项目不依赖它们。

## 搜索通道

`search` 会组合并去重四类可解释通道：

- FTS5 chunk 匹配；连续中文、日文和韩文会增加轻量 CJK n-gram token。
- 精确技术实体匹配。
- 匹配实体和文档周围的图邻居。
- 当支持的 provider 已启用、完成索引并被请求时，增加可选 embedding vector 匹配。

Reciprocal rank fusion（RRF）会融合当前激活的通道。结果保留原因、命中实体、edge provenance，以及可选的 semantic provider/model metadata。语义结果是附加信号，不会替代确定性通道。

## 语义 Provider

Embedding 采用 provider 接口；默认配置仍关闭 embedding。

| Provider | 能力 | 用途 |
|---|---|---|
| `local-hash` | `lexical-hash` | 用于兼容和确定性词法投影。它不是语言模型 embedding，不能被视为同义词理解。 |
| `ollama` | `semantic-model` | 通过单独运行的本地 Ollama 服务和 embedding 模型提供可选语义检索。 |

Ollama 配置示例：

```json
{
  "embedding": {
    "enabled": true,
    "provider": "ollama",
    "model": "nomic-embed-text",
    "dimensions": 768,
    "endpoint": "http://127.0.0.1:11434",
    "timeoutMs": 30000,
    "batchSize": 16
  }
}
```

执行语义查询前先建立完整的 provider-backed index：

```bash
mdgraph index --full --semantic --path /path/to/project
mdgraph semantic status --path /path/to/project
mdgraph search --semantic --path /path/to/project "authentication login"
```

Provider identity、model、dimensions 与 vector coverage 会随索引保存。修改 profile 后必须完整语义重建。Embedding 会在 repository 写入开始前完成，因此 provider 失败不会提交不完整的 graph 或 vector coverage。

查询阶段如遇 provider 不可用、超时、非法响应、缺少模型或 vector profile 不完整，会降级到 FTS5/entity/graph 检索。CLI 与 MCP 输出会增加 `semanticDiagnostic`；仍可用的词法结果不会被转成错误。

## 确定性实体抽取

实体抽取会感知来源并优先保证精度。它是可解释的启发式规则，不是通用命名实体识别，也不是编程语言 AST。

| 来源 | 推断的技术信号 |
|---|---|
| Front matter 和 `Defines` / `定义` section | 显式 definition，包括本会被 stop list 抑制的名称。 |
| 技术标题 | API route、Latin symbol、具有明确形状的 config key 和空调用函数形式。 |
| 普通正文 | API route、error code、具有明确形状的 uppercase/dotted config key，以及分段 CJK config key。 |
| 独立 inline code | 结构化信号，以及完整的 Latin 或 CJK symbol 值。 |
| Fenced code | 结构化信号、空调用函数、声明名称和有界 type-reference 上下文。 |
| Markdown/WikiLink | 结构化 link 信号；WikiLink label 必须像一个完整实体。 |

普通正文和代码块不会宽泛扫描 PascalCase，从而避免把 “The”、“When”、“Note” 等词提升为图节点。`entities.stopEntities` 会抑制所有推断 reference kind；作者显式声明的 definition 仍具有权威性。

Unicode-aware 规则可识别 `POST /接口/登录` 这样的 CJK API path、`登录.认证.重试` 这样的分段 key，以及 `验证登录()`、`認証を確認()` 这样的空调用 identifier。Route 边界会阻止 `src/auth/session.ts` 同时产生截断的 `/auth/session.ts`。没有显式结构证据时，不会把普通 CJK 正文推断为实体。

## 上下文打包

`context` 从排序后的 search section 开始，通过非 containment edge 做有界图扩展，并在字符预算内打包入选 section。

兼容默认策略 `mmr-style-document-round-robin` 按文档轮询引入候选。它保持确定性和既有行为，但不会计算候选之间的相关性与冗余。

真正的 MMR 必须显式选择：

```bash
mdgraph context --packing mmr --mmr-lambda 0.65 --debug --json \
  --path /path/to/project "session recovery"
```

MCP caller 使用 `packingStrategy: "mmr"` 选择同一行为，也可以提供 `mmrLambda`。MMR 每一步最大化：

```text
lambda * queryRelevance - (1 - lambda) * maximumSimilarityToSelected
```

当两个 chunk 都有当前 provider/model 的存储 vector 时，候选相似度使用该 vector；否则使用确定性的 Unicode-token Jaccard。与同文档已选 section 相似度至少为 `0.8` 的候选会被剪除，但另一个文档的首个候选仍会作为跨文档证据保留。

每个结果都包含 `packing` metadata。`--debug` 还会报告候选与图扩展数量、similarity source、lambda、逐项 relevance/redundancy score、被剪除的重复项和预算截断。

## 边界与评估

- CJK n-gram 改善词法匹配，但不提供形态分析、分词、翻译或同义理解。
- 实体规则只识别有界的技术形状；权威领域实体应通过显式 front matter 声明。
- Embedding 质量取决于所选模型和目标语料。仓库 fixture 验证集成行为，不代表任意模型的通用质量。
- MMR 在仓库 fixture 上降低了实测冗余，但最佳 lambda 和相似度阈值仍取决于语料。

公开 `eval` 命令、回归套件和证据边界见[评估](Evaluation_Questions.md)。索引新鲜度与 provider 故障恢复见[运行与故障处理](Operations.md)。

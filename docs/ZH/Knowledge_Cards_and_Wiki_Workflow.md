---
status: implemented
defines:
  - KnowledgeCard
  - WikiPlan
  - WikiPageBrief
  - WikiStatus
  - WikiVerification
source_refs:
  - src/query/knowledge-card.ts
  - src/query/context-builder.ts
  - src/query/search.ts
  - src/query/trace.ts
  - src/db/repositories.ts
  - src/mcp/tools.ts
  - src/bin/mdgraph.ts
  - src/wiki/wiki-plan.ts
  - src/wiki/wiki-status.ts
---

# Knowledge Card 与 Wiki 工作流设计

## 1. 决策摘要

MDGraph 将 Knowledge Card 与 Wiki 视为两个不同能力域：

- **Knowledge Card** 是基于当前图、按请求动态构建的紧凑知识视图。它增强既有
  `node`、`context`、`search` 和 `trace`，不生成独立文件，不新增 MCP 工具，
  不创建第二套知识库。
- **Wiki** 是面向用户的项目文档手册。MDGraph 确定性地产生目录规划、单页证据
  brief、影响状态和验证结果；宿主 Agent 阅读过程文档和代码库后，编写或更新
  用户可维护的交付文档。

MDGraph 不内置 Wiki 正文生成模型，不新增 Ollama/generation provider，不为 Wiki
创建独立向量索引。现有可选 embedding 继续只服务检索。

## 2. 问题与边界

MDGraph 已能确定性地索引 Markdown 文档、章节、实体、source refs 和关系，也能按
预算返回 explainable context。缺少的是：

1. Agent 定点查看一个节点时，需要自行拼接定义、来源和邻居信息。
2. Agent 编写项目手册时，缺少稳定的目录规划、逐页证据边界和更新影响判断。
3. 用户需要的是连贯的说明手册，而不是 GraphJSON、edge dump 或模块卡目录。

本设计不试图把 MDGraph 变成源码图、RAG 平台、站点生成器或模型运行时。

## 3. 非目标

- 不新增 `mdgraph_card` 或 `mdgraph_wiki` MCP 工具。
- 不持久化 card，不为 card 创建 SQLite 表。
- 不把 source symbols 或模块关系写入主图。
- 不自动调用 LLM 或远程服务。
- 不自动覆盖用户维护的 Wiki 正文。
- 不生成独立的静态 card 仓库。
- 不以页面数量、实体数量或关系数量作为成功指标。
- 不承诺 Agent 生成的自然语言正文具有字节级确定性。

## 4. Knowledge Card

### 4.1 定位

Knowledge Card 是内部 query projection。它把一个已解析图节点的高价值事实压缩成
固定预算内的结构化摘要，便于 Agent 决定下一步读什么。

```ts
interface KnowledgeCard {
  nodeId: string;
  kind: "document" | "section" | "entity" | "source_ref";
  label: string;
  summary: string;
  definitions: CardReference[];
  sourceRefs: CardSourceReference[];
  relatedDocuments: CardReference[];
  evidence: CardEvidence[];
  truncated?: {
    definitions?: number;
    sourceRefs?: number;
    relatedDocuments?: number;
    evidence?: number;
  };
}
```

`summary` 是确定性模板文本，不是模型总结。所有数组必须稳定排序，并携带已有的
node ID、path、edge kind、provenance、confidence 或行范围等恢复信息。

### 4.2 节点视图

| 节点类型 | Card 重点 |
|---|---|
| document | 状态、类型、trust tier、主要章节、定义实体、source refs、直接相关文档 |
| section | 所属文档、heading/anchor/lines、定义和引用实体、source refs、相邻关系 |
| entity | kind、定义位置、引用文档、相关 source refs、图邻居 |
| source_ref | 项目相对路径、引用它的文档/章节、IMPLEMENTS/REFERENCES_SOURCE 证据 |

第一批实现只使用当前 SQLite 图。Source Bridge enrichment 必须作为后续独立、可选
实验，不阻塞 Card 的基础价值。

### 4.3 与现有功能融合

#### `node`

`node --json` 和 `mdgraph_node` 在现有节点字段之外，增量返回 `card`。文本模式在
节点基本信息后打印紧凑 Card。这是第一优先级的公开入口。

#### `context`

`context` 不为每个 item 附加完整 Card。packer 仅为被选中的高相关节点加入
`cardSummary`，并将其字符数计入 `usedChars`。超出预算时先截断 Card，而不是挤掉
原始文档内容和 recovery fields。

#### `search`

第一批不改变 ranking 或 JSON shape。内部 Card builder 可用于改善可读的 `reason`，
但必须保持原有检索通道、分数和结果顺序。

#### `trace`

第一批不改变 trace path。文本 formatter 可复用 Card label；任何 JSON 增量必须
在 node/context 验证后再决定。

### 4.4 预算

建议默认每张 Card：

- 最多 8 个 definitions。
- 最多 8 个 source refs。
- 最多 8 个 related documents。
- 最多 12 个 evidence records。
- 最大 4,000 字符。

截断必须报告省略数量。Card builder 不读取 Markdown 正文，不复制 chunk 内容，
因此不会成为 context 的第二份正文。

## 5. Wiki 工作流

### 5.1 定位

Wiki 是用户可阅读、可评审、可提交版本控制的交付文档。MDGraph 负责确定性的
**规划、取证、影响分析和验证**；宿主 Agent 负责自然语言编写与修改。

```text
文档图 + 用户任务 + 已知源码路径
    -> WikiPlan
    -> WikiPageBrief
    -> 宿主 Agent 阅读文档与代码
    -> 编写/更新 Markdown
    -> WikiStatus + WikiVerification
```

正文不是图的投影，也不是 Card 的拼接。Agent 应将过程文档、架构决策、源码入口
和实际行为重组为连贯手册。

### 5.2 命令

```bash
mdgraph wiki plan --out .mdgraph/wiki-plan.json --path <project>
mdgraph wiki brief <page-id> --plan .mdgraph/wiki-plan.json --json --path <project>
mdgraph wiki status <wiki-dir> --plan .mdgraph/wiki-plan.json --json --path <project>
mdgraph wiki verify <wiki-dir> --plan .mdgraph/wiki-plan.json --json --path <project>
```

不提供 `wiki generate`。调用哪个 Agent、模型或代码阅读工具由宿主环境决定。

### 5.3 WikiPlan

```ts
interface WikiPlan {
  format: "mdgraph-wiki-plan";
  formatVersion: 1;
  graphHash: string;
  sourceHash: string;
  pages: WikiPlanPage[];
}

interface WikiPlanPage {
  id: string;
  title: string;
  path: string;
  parentId?: string;
  purpose: string;
  audience: string;
  outline: string[];
  documentIds: string[];
  sourceRefs: string[];
  evidenceQueries: string[];
  evidenceHash: string;
}
```

Plan 必须稳定排序并使用稳定 page ID。路径是相对于目标 Wiki 目录的安全路径。
Plan 不包含 Markdown 正文。

### 5.4 目录规划规则

规划器根据实际证据选择页面，不生成空分类。候选域包括：

| 域 | 主要证据 |
|---|---|
| 项目概览 | README、文档入口、package metadata、核心概念 |
| 架构设计 | architecture/design 文档、ADR、IMPLEMENTS/source refs |
| 核心工作流 | feature chain、API、跨文档关系、主要源码入口 |
| 开发指南 | AGENTS、贡献指南、构建/测试命令、配置说明 |
| 运行与排障 | runbook、incident、error code、doctor/operation 文档 |
| 参考 | CLI、MCP、API、config keys、稳定输出契约 |

目录规划使用文档类型、标题、front matter、显式链接和 source refs。不得依据 embedding
相似度单独创建页面。

### 5.5 WikiPageBrief

```ts
interface WikiPageBrief {
  format: "mdgraph-wiki-page-brief";
  formatVersion: 1;
  page: WikiPlanPage;
  maxChars: number;
  usedChars: number;
  sourceDocuments: WikiBriefSourceDocument[];
  contextItems: ContextItem[];
  knowledgeCards: KnowledgeCard[];
  writingRequirements: string[];
  suggestedNextQueries: string[];
}
```

Brief 复用现有 `buildContext`、knownFiles、source refs 和预算规则。它必须告诉 Agent：

- 页面面向谁、解决什么问题。
- 建议章节，但不要求机械照抄。
- 哪些是权威过程文档。
- 哪些源码路径需要进一步阅读。
- 哪些结论已有直接证据，哪些仍需核验。
- 必须保留哪些引用和恢复路径。

### 5.6 交付页面 front matter

```yaml
---
wiki_id: architecture-overview
evidence_hash: "..."
source_docs:
  - docs/EN/Architecture.md
source_refs:
  - src/indexer.ts
  - src/db/repositories.ts
---
```

`wiki_id` 和 `evidence_hash` 是维护字段。`source_docs`、`source_refs` 必须是由非空
项目相对路径组成的数组；标量、空元素和混合数组都是无效证据，`wiki verify` 会给出
对应字段的恢复操作。用户可以修改正文；MDGraph 不自动覆盖。

### 5.7 Status

```ts
type WikiPageState = "current" | "needs_update" | "missing" | "orphaned";
```

- `current`：页面存在，evidence hash 与当前 plan 一致，且引用的 Markdown 文档在磁盘上
  仍与索引内容一致。
- `needs_update`：页面存在，但依赖文档/source refs/plan 已变化。即使保留了文件 mtime，
  严格内容 hash 也会识别已改动或已删除的引用文档；只影响引用该文档的页面。
- `missing`：plan 要求页面但目标文件不存在。
- `orphaned`：目标目录存在带 `wiki_id` 的页面，但 plan 已不再包含它。

Status 只报告，不修改文件。每个非 current 状态都必须提供原因和恢复命令。
新增 Markdown 文档会使 plan 变为 stale，并提示先重新索引再重建 plan；不会把无关页面
全部标记为 `needs_update`。

### 5.8 Verification

`wiki verify` 检查：

- Plan format/version/hash 是否可读。
- 每个 plan page 是否存在且 `wiki_id` 匹配。
- `source_docs` 是否是当前已索引文档。
- `source_refs` 是否是项目相对、安全且仍存在的路径。
- 文档内相对链接是否可解析。
- 严格内容 hash 下的 evidence 是否过期；索引未知或 stale 时验证无效，先重新索引。
- 是否存在 missing/orphaned 页面。

验证不判断自然语言是否“写得好”，也不把缺少模型评审当作失败。

## 6. Agent 编写工作流

仓库提供可复用 prompt/skill，宿主 Agent 按以下顺序工作：

1. 读取 WikiPlan。
2. 针对一个 page ID 获取 WikiPageBrief。
3. 用 MDGraph 阅读过程文档；用宿主代码工具阅读 brief 指定的源码。
4. 编写面向用户的说明、示例和必要图表。
5. 保留/更新 front matter 来源。
6. 运行 `wiki verify`。
7. 只修复当前页面的验证问题，不顺带改写无关页面。

批量更新时先运行 `wiki status`，只处理 `needs_update` 和 `missing`。

Plan 与 brief 都会附加 `strictFreshness`，说明生成时严格 Markdown 内容 hash 的结果。
其状态为 stale 或 unknown 时，先运行 `mdgraph index`，再重建 plan 或获取新的 brief，
不能把现有证据当作 current。

## 7. 实施批次

### Batch A：撤销错误公共接口

- 不合并实验性的 `export wiki` 和静态 card/module artifact。
- 保留既有 `export docs-site`、GraphJSON 和 source bridge 行为。
- 不修改 MCP 五工具。

### Batch B：动态 Card

- 新增内部 `src/query/knowledge-card.ts`。
- 实现四类节点 Card 和预算截断。
- 先接入 `node`，再接入 `context`。
- 用现有 fixture 验证 provenance、source refs 和恢复字段。

### Batch C：Plan 与 Brief

- 实现稳定目录规则和 `WikiPlan` v1。
- 实现基于 context builder 的 `WikiPageBrief`。
- CLI 仅写 plan/brief，不写正文。

### Batch D：Status 与 Verify

- 实现 front matter 读取、evidence hash、缺页/孤儿页检测。
- 验证项目相对路径和内部 Markdown 链接。
- 所有失败提供可执行恢复建议。

### Batch E：Agent 工作流与真实验收

- 增加 Wiki page authoring prompt/skill。
- 用 MDGraph 仓库自身生成一套用户手册。
- 由新用户任务和 Agent A/B 共同验收。

## 8. 测试与验收

### Card 验收

- `node` 一次调用能返回定义、来源和直接相关文档。
- Card 不改变 search ranking、trace path 或 SQLite counts。
- `context.usedChars` 包含 Card 字符，且不突破预算。
- 大节点稳定截断并报告省略数量。
- 同一图产生字节稳定 Card。

### Wiki 工作流验收

- 同一 graph/source hash 产生字节稳定 WikiPlan 和 Brief。
- 没有相关证据的分类不会生成空页面。
- 修改一个依赖文档只使相关页面进入 `needs_update`。
- 用户编辑正文不会被 status/verify 覆盖。
- 缺失引用具有明确路径和恢复建议。
- 不配置模型、embedding 或 Source Bridge 也能完成 plan/brief/status/verify。

### 用户价值验收

用 MDGraph 自身手册验证用户能否完成：

1. 理解产品定位。
2. 安装并建立索引。
3. 接入编码 Agent。
4. 使用 search/context/node/trace。
5. 排查 stale index、watch 和 provider 问题。

### Agent 价值验收

对真实任务进行 A/B：

- 基线：现有 MDGraph 工具。
- 实验：现有工具 + KnowledgeCard/WikiPageBrief。

记录首个正确文件命中率、上下文字符数、正确性和完成时间。没有可测提升时，不扩展
Card 字段或 Wiki 自动化。

## 9. 兼容与停止条件

- Card 字段先标记 `experimental`、`stable-additive`。
- Wiki 是新的实验性 CLI group，不加入 MCP。
- 不改变 GraphJSON v1、SQLite schema 或 edge kind。
- 不因 Source Bridge、模型、embedding、站点工具缺失而禁用基础能力。
- 若实现需要把代码正文持久化到第二套索引、自动调用远程模型或覆盖用户正文，停止并
  重新评审产品边界。

## 10. 实施状态

动态 Card、Plan/Brief、Status/Verify、CLI 和宿主 Agent authoring workflow 均已实现。
`node` 暴露完整 Card，`context` 只使用正文装入后的剩余预算增加 Card summary，
`wiki plan/brief/status/verify` 保持为实验性 CLI-only group。仓库自有 `wiki/` 手册和
`agent-pack/skills/wiki-authoring` 使用真实工作流验收，未增加模型 provider，也未改变
五工具 MCP surface。

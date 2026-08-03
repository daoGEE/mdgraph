---
title: 结构化查询与派生关系
type: guide
status: active
source_refs:
  - src/query/structured-query.ts
  - src/query/structured-query-executor.ts
  - src/relationships/derive-related.ts
  - src/db/repositories.ts
---

# 结构化查询与派生关系

除自然语言检索外，MDGraph 还提供两个实验性、必须显式执行的工作流：用于文档治理的有界结构化查询语言，以及用于派生非权威 `RELATED_TO` edge 的 provider 门禁流程。两者都不会改变稳定的 `search` 行为，也不会增加 MCP 工具。

## 结构化查询

当需求是过滤或审计，而不是相关性排序搜索时，使用 `query`：

```bash
mdgraph query --path /path/to/project 'type:adr AND status:accepted' --json
mdgraph query --path /path/to/project 'type:adr AND edge.IMPLEMENTS ~ auth' --json
mdgraph query --path /path/to/project 'type:runbook AND health:dead_link ORDER BY updated DESC' --json
mdgraph query --path /path/to/project 'updated >= 2026-06-21 AND NOT status:draft LIMIT 25' --json
```

`:` 是 `=` 的别名。包含空格的值必须加引号。Keyword 和 field name 不区分大小写。

### 语法

```text
query       := expression [ORDER BY sort ("," sort)*] [LIMIT integer]
expression  := or-expression
or          := and (OR and)*
and         := unary (AND unary)*
unary       := NOT unary | "(" expression ")" | predicate
predicate   := field operator value
operator    := = | != | ~ | !~ | < | <= | > | >= | :
sort        := sortable-field [ASC | DESC]
```

`AND` 优先于 `OR`，括号用于显式分组。输入限制为 10,000 字符、256 tokens、64 predicates、24 层嵌套、三个 sort field，以及 `LIMIT 1..500`。

### 字段

| 字段 | 含义 | Operator |
|---|---|---|
| `type` | 文档类型 | `=`, `!=`, `~`, `!~` |
| `status` | 生命周期状态 | `=`, `!=`, `~`, `!~` |
| `trust` / `trust_tier` | Trust tier | `=`, `!=`, `~`, `!~` |
| `path`, `title` | 已索引 path 或 title | `=`, `!=`, `~`, `!~` |
| `updated` / `updated_at` | 索引时捕获的源文件 mtime | 日期比较 |
| `indexed` / `indexed_at` | 索引时间 | 日期比较 |
| `tag` / `tags` | 显式 front-matter tags | `=`, `!=`, `~`, `!~` |
| `edge` | 是否存在指定类型的 outgoing edge | `=`, `!=` |
| `edge.<KIND>` | 目标匹配 id、path/title、section heading/anchor、entity 或 source ref 的 outgoing edge | `=`, `!=`, `~`, `!~` |
| `health` | Doctor 派生的文档健康类型 | `=`, `!=` |

`~` 是大小写不敏感的 substring 操作；`%` 和 `_` 不是 wildcard。日期接受 `YYYY-MM-DD` 或 ISO timestamp。可排序字段为 `path`、`title`、`type`、`status`、`trust`、`updated` 和 `indexed`。

Health 值包括 `dead_link`、`orphan`、`stale_source_ref`、`missing_definition`、`weakly_linked`、`possible_contradiction` 和 `content_risk`。索引陈旧时 health predicate 会拒绝执行，避免把当前文件与旧 graph state 混在一起。

### 执行与安全

Parser 只接受已记录的 field、operator、document kind、trust tier、edge kind、health value、date、sort field 和 limit。非 health expression 会编译成白名单 SQL fragment 并使用 bound parameter；用户值不会插值到 SQL。Edge kind、column 与 sort direction 必须先通过 closed-enum 校验才能进入 SQL。

包含 health predicate 的查询会分别运行参数化原子文档 predicate 和 doctor-derived health set，再对原始 boolean AST 求值，从而保留 `AND`、`OR` 和 `NOT` 语义。不支持任意 front-matter key、raw SQL、incoming-edge predicate、join 或 aggregation。

JSON 输出包含校验后的 AST、执行策略和阶段、parameter count、total/returned count、truncation state、匹配文档、原因、predicate field 与 provenance。完整形状见[输出契约](Output_Contracts.md#query---jsonexperimental)。

## 派生相关文档关系

`relationships derive` 从已经完整建立的真实模型 vector index 创建可选语义关系层。它不会在普通 indexing 或 watch mode 中运行，也不会使用 `local-hash`。

```bash
mdgraph index --semantic --full --path /path/to/project
mdgraph relationships derive --dry-run --json --path /path/to/project
mdgraph relationships derive --threshold 0.86 --max-neighbors 3 \
  --min-evidence 2 --json --path /path/to/project
```

写入 edge 前应始终针对自己的语料检查 dry run。成功的非 dry run 会原子替换既有 `RELATED_TO/embedding_similarity` edge，因此重复执行不会累积 duplicate。

### 运行门禁

除非以下检查全部通过，否则派生流程拒绝修改 graph：

- Doctor content-hash/ID audit 报告 fresh index 且没有 Markdown parse failure。
- Embedding 已启用，当前 provider 声明 `semantic-model` capability。
- 每个已索引 chunk 都有当前 provider、model 与 dimensions 的有效 vector。
- Threshold 不低于 `0.75`（默认 `0.86`）。
- 每条关系至少有两组超过 threshold 的独立 chunk/section match；同一 chunk 不能占用多个 evidence slot。
- 文档对通过 reciprocal top-K（默认每个文档三个邻居）。

这些是保守的发射门禁，不是对模型或语料的认证。应使用有代表性的项目文档校准 threshold。

### 算法与资源边界

流程会为每个 eligible document 最多均匀采样 12 个 chunk，把 normalized chunk vector 平均成 document centroid，用保守 centroid floor 筛选候选，然后检查独立 section evidence 和 reciprocal neighbor。

如果工作量将超过 250,000 个 document pair、2,000,000 次 section-vector 比较或 100,000,000 次 vector-component 比较，命令会失败，而不是静默截断。Chunk 数少于 `min-evidence` 的文档不能发射关系。`max-neighbors` 接受 `1..10`，`min-evidence` 接受 `2..4`。

### 存储契约与生命周期

每个通过的文档对会存成两条 directed `RELATED_TO` edge，使 outgoing query 可从任一文档工作。Edge 使用较低的 `weight: 2`、`embedding_similarity` provenance、由所需 evidence pair 计算的 confidence、稳定的 endpoint/kind/provenance ID，并在 metadata 中记录 provider、model、dimensions、algorithm、gate、threshold、reciprocal top-K、evidence、symmetry 和 generation time。

派生 edge 参与 graph retrieval、trace 和结构化 outgoing-edge query。Doctor 在权威 orphan/weak-link 计数中排除它们，因此推断关系不会掩盖缺失的人工维护链接。增量索引会删除接触 changed/deleted document 的派生 edge；完整重建会移除整个派生层。完成语义重建后需要再次运行派生流程。

Structural GraphJSON 会包含 edge kind、confidence 和 provenance，但根据既有隐私 profile 省略 edge metadata。派生报告见[输出契约](Output_Contracts.md#relationships-derive---jsonexperimental)。

Embedding 相似度不证明 identity、contradiction、causality 或逻辑等价。`SAME_AS` 与 `CONTRADICTS` 继续保留；作者显式链接仍具有权威性。

---
title: 运行与故障处理
type: runbook
status: active
defines:
  - MDGraphOperationsZH
source_refs:
  - src/indexer.ts
  - src/watcher/file-watcher.ts
  - src/watcher/watch-health.ts
  - src/semantic/status.ts
---

# 运行与故障处理

本文说明长期运行 MDGraph 时的索引新鲜度、watch coverage、semantic provider 恢复和本地产物安全。

## 索引与新鲜度检查

在依赖陌生项目或长期运行的索引前，先显式检查状态：

```bash
mdgraph status --freshness --path /path/to/project
mdgraph status --storage --path /path/to/project
mdgraph doctor --path /path/to/project
```

`status --freshness` 会比较当前 Markdown 文件与已索引的 path/hash。`stale` 表示查询结果可能反映旧 graph state，应运行 `mdgraph index`。Doctor health predicate 和派生关系都要求 fresh index，并拒绝混合时间状态的结论。

增量索引会更新 changed/deleted document、对应 FTS record、vector 和相连的派生 edge。Embedding profile 改变、存储需要重建/压缩，或运维上希望做干净重建时，使用 `index --full`。

## Watch 模式

独立 watch mode 和集成 MCP serving 都可以保持索引最新：

```bash
mdgraph watch --path /path/to/project
mdgraph serve --mcp --path /path/to/project
```

Watcher 通过 `WatchHandle.getHealth()` 暴露进程内 health snapshot。集成 MCP serving 会把它加入 `mdgraph_status.structuredContent.watchHealth`。

| 状态 | 含义 | 运维动作 |
|---|---|---|
| `starting` | 正在注册 watch 或执行初始 setup。 | 等待进入 healthy 或报告启动失败。 |
| `healthy` | 注册有效，最近一次索引成功。 | 无需动作。 |
| `degraded` | 索引失败，或原生 watch coverage 已不可靠。 | 检查最近错误；修复原因后重新索引或重启。 |
| `failed` | 启动阶段无法建立可靠 watch coverage。 | 修复报告的错误后再依赖 watch mode。 |

Snapshot 包含最近成功索引时间、最近错误、failure phase 与 normalized code、连续索引失败次数、coverage reliability、polling 和 closed 状态。它只在 watcher 进程内持续；重启会创建新的 health lifecycle。

启动注册错误是 fatal。索引失败可以在后续索引成功后恢复。`ENOSPC`、`EMFILE` 等运行期 watch error 会设置 `coverageReliable: false`；后续手动或触发索引成功并不能证明漏掉的原生事件已恢复，因此在重启前保持 degraded。

## Polling Fallback

默认使用原生文件系统事件。当操作系统 watch limit 无法提高或原生事件不可靠时，可以显式启用 polling：

```bash
mdgraph watch --poll --path /path/to/project
mdgraph serve --mcp --watch-poll --path /path/to/project
```

Polling 可能增加 I/O 与 CPU，因此不会自动开启。大型长期运行仓库应优先修复操作系统资源限制；无法控制环境时再使用 polling。

## Semantic Provider 恢复

使用以下命令检查 provider 和 vector 状态：

```bash
mdgraph semantic status --path /path/to/project
```

| 条件 | 查询行为 | 恢复方式 |
|---|---|---|
| Provider 不可用、超时或响应非法 | Search/context 降级到 FTS5/entity/graph 并报告 `semanticDiagnostic`。 | 恢复服务/模型后重试；词法结果仍可使用。 |
| Provider/model/dimensions 改变 | Status 报告需要重新索引。 | 运行 `mdgraph index --full --semantic`。 |
| 语义索引失败 | Embedding 在 mutation 前完成，因此既有 graph 保持不变。 | 修复 provider 后重新索引。 |
| Vector coverage 不完整 | 语义查询降级；派生关系拒绝修改。 | 重建完整语义索引。 |

`local-hash` 不需要外部服务，但它只是词法 feature hash，不能通过派生关系的 semantic-model 门禁。

## 派生关系刷新

派生 `RELATED_TO` edge 是可丢弃、非权威状态。文档变更会删除接触它的派生 edge，完整重建会删除全部派生关系。成功完成 full semantic index 后，如仍需要该层，应先执行 dry run，再显式刷新。详见[结构化查询与派生关系](Structured_Query_and_Relationships.md#派生相关文档关系)。

## 本地与发布产物

- 不要把 `.mdgraph/graph.db`、包含本地路径的 bundle/report 或私有评估语料加入 source control 或 release archive。
- `.mdgraph/config.json` 不含凭据时可以跟踪；MDGraph 会拒绝 endpoint URL 中嵌入的凭据。
- 结构化交换应使用已记录的 GraphJSON，不要依赖 SQLite 内部结构。
- 发布 MDGraph 本身前，运行[发布清单](Release_Checklist.md)，检查 `npm pack --dry-run --json`，并实际验证 packed package，不要假设仓库内容等同于 npm 内容。

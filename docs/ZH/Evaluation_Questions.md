# MDGraph 评估

这些问题是一组可复用的工程冒烟测试，可在索引后用于真实项目文档语料。它们检查 MDGraph 是否返回正确的文档、章节、实体、图证据和上下文，而不是把单一排序分数当作充分证据。

内置 CLI 入口：

```bash
mdgraph eval --json
mdgraph eval --path /path/to/project --json
mdgraph eval --query-set cjk --path /path/to/project --json
mdgraph eval --query-mode semantic --json
```

`mdgraph eval` 默认运行仓库自有的 `alpha` query set，并报告 pass/fail 与轻量检索指标，同时给出 query mode、RRF channel、兼容上下文打包和可选 semantic-provider 状态。`--query-set cjk` 选择由轻量 CJK n-gram 预处理覆盖的小型中文/日文检索基线。这些是确定性的工程检查，不是完整 IR benchmark 或真实 agent A/B benchmark。

## 仓库回归套件

除 `mdgraph eval` 外，维护者还会运行聚焦的非公开套件。套件名称直接描述其保护的能力。它们不会增加已冻结的 `eval --query-set alpha | cjk` 值，也不会写入仓库的 `.mdgraph` 索引。

| 命令 | 保护的能力 | 已记录结果 / 门禁 |
|---|---|---|
| `npm run baseline:historical` | 历史 lexical-hash、实体、上下文和 watch failure 对比快照 | Keyword 同义词 Recall@5 `0.0000`，`local-hash` 为 `0.5000`；历史实体 precision/recall 为 `0.5000 / 1.0000`；文档轮询 average pairwise Jaccard 为 `0.3808`，有三组近重复。这些数值是刻意保持不变的历史证据。 |
| `npm run baseline:entity-extraction` | Source-aware Latin/CJK 实体抽取 | Precision `1.0000`、recall `1.0000`、CJK recall `1.0000`、已知噪声泄漏为零；门禁分别为 `>= 0.90`、`>= 0.80`、`>= 0.80` 和零。 |
| `npm run baseline:context-packing` | 可选真 MMR 上下文打包 | Expected-document recall 保持 `1.0000`；average pairwise Jaccard 从 `0.3808` 降至 `0.1576`，近重复 pair 从三组降为零，冗余降低 `58.61%`。 |
| `npm run baseline:structured-query` | 结构化查询正确性与安全 | 四条标注治理 query 全部正确，repository predicate 参数化与 SQL injection 隔离通过。 |
| `npm run baseline:related-documents` | Provider 门禁相关文档派生 | Precision `1.0000`、recall `1.0000`、provenance 完整且替换结果确定；门禁要求 precision `>= 0.90`、recall `>= 0.80`、完整 provenance 和稳定替换。 |

Provider 集成 fixture 还通过确定性的 fake Ollama endpoint 映射四条无词面重叠语义 case，Recall@5 达到 `1.0000`。它验证 batching、vector persistence、async routing、RRF 参与、诊断和 provider attribution，不预测任意真实模型的质量。

Watcher tests 覆盖启动/运行期 `ENOSPC`、运行期 `EMFILE`、启动期 `EACCES`、索引失败、恢复、进程内持续 health 和显式 polling。各套件背后的用户行为见[检索与上下文](Retrieval_and_Context.md)、[运行与故障处理](Operations.md)和[结构化查询与派生关系](Structured_Query_and_Relationships.md)。

1. 为什么某个特定的错误码会影响特定的用户流程？
2. 给定的设计文档依赖于哪些早期决策？
3. 某个特定的 API 路由在哪里定义、又在哪里被引用？
4. 修改某个配置键会影响哪些运行手册或运维笔记？
5. 哪些文档已被更新的设计文档所取代？
6. 与某个事故报告相关的设计假设有哪些？
7. 哪些文档对应某个特定的源码路径？
8. 哪些文档提到了相同的实体但彼此之间没有链接？
9. 哪些设计文档缺少 `source_refs`？
10. 一个特定功能从需求到实现的完整文档链是什么？

## 参考语料库预期记录

仓库测试 fixture `createAlphaFixtureDocs` 定义了一组小型参考语料库。以下记录是确定性的冒烟预期，不代表已经完成真实代理 A/B 基准测试。

| ID | 查询重点 | 预期文档 | 预期实体 | 预期边 | 预期 source refs |
|---|---|---|---|---|---|
| 1 | `RedisTimeoutError` 对 `LoginFlow` 的影响 | `docs/redis-cache-design.md`, `docs/login-flow.md`, `docs/runbooks/auth-retry-runbook.md` | `RedisTimeoutError`, `LoginFlow`, `AuthRetryRunbook` | `REFERENCES`, `DEPENDS_ON` | `src/cache/redis.ts`, `scripts/restart-auth.ps1` |
| 2 | `Auth v2 Design` 依赖的较早决策 | `docs/auth-v2-design.md`, `docs/adr/adr-001-cache-failure-policy.md`, `docs/redis-cache-design.md` | `AuthService`, `CacheFailurePolicy`, `RedisTimeoutError` | `DEPENDS_ON`, `DEFINES` | `src/auth/AuthService.ts`, `src/cache/redis.ts` |
| 3 | `GET /api/auth/login` 的定义和引用 | `docs/api/login-api.md`, `docs/login-flow.md`, `docs/auth-v2-design.md` | `GET /api/auth/login`, `AuthService`, `RedisTimeoutError` | `DEFINES`, `IMPLEMENTS`, `DEPENDS_ON` | `src/routes/auth.ts` |
| 4 | `AUTH_RETRY_LIMIT` 的运维影响 | `docs/runbooks/auth-retry-runbook.md`, `docs/redis-cache-design.md`, `docs/login-flow.md` | `AUTH_RETRY_LIMIT`, `AuthRetryRunbook`, `LoginFlow` | `REFERENCES`, `DEPENDS_ON` | `scripts/restart-auth.ps1` |
| 5 | 被取代的设计文档 | `docs/auth-v2-design.md`, `docs/auth-v3-design.md` | `AuthService`, `AuthServiceV3` | `SUPERSEDES`, `DEPRECATED_BY` | `src/auth/AuthService.ts`, `src/auth/AuthServiceV3.ts` |
| 6 | 与事故相关的设计假设 | `docs/incidents/redis-timeout-incident.md`, `docs/redis-cache-design.md`, `docs/runbooks/auth-retry-runbook.md` | `RedisTimeoutError`, `LoginFlow`, `AuthRetryRunbook` | `DEPENDS_ON`, `REFERENCES` | `src/cache/redis.ts`, `scripts/restart-auth.ps1` |
| 7 | `src/routes/auth.ts` 对应的文档 | `docs/api/login-api.md`, `docs/login-flow.md` | `GET /api/auth/login`, `LoginFlow` | `IMPLEMENTS`, `DEPENDS_ON` | `src/routes/auth.ts` |
| 8 | 提到相同实体但没有直接链接的文档 | `docs/redis-cache-design.md`, `docs/incidents/redis-timeout-incident.md`, `docs/runbooks/auth-retry-runbook.md` | `RedisTimeoutError`, `LoginFlow` | `REFERENCES`, 图邻居扩展 | `src/cache/redis.ts`, `scripts/restart-auth.ps1` |
| 9 | 缺少 `source_refs` 的设计文档 | 预期 `docs/auth-v3-design.md` 通过 `IMPLEMENTS` 关联源码；干净语料库中不预期存在 stale source ref | `AuthServiceV3` | `IMPLEMENTS` | `src/auth/AuthServiceV3.ts` |
| 10 | 登录功能从需求到实现的文档链 | `docs/login-flow.md`, `docs/api/login-api.md`, `docs/auth-v2-design.md`, `docs/redis-cache-design.md`, `docs/adr/adr-001-cache-failure-policy.md` | `LoginFlow`, `GET /api/auth/login`, `AuthService`, `RedisTimeoutError`, `CacheFailurePolicy` | `DEPENDS_ON`, `IMPLEMENTS`, `DEFINES` | `src/routes/auth.ts`, `src/auth/AuthService.ts`, `src/cache/redis.ts` |

## 测量说明

对于每个问题，对比附加 MDGraph 前后代理的行为：

- 最终答案是否引用了正确的文档。
- 避免了多少次直接的文件读取或文本搜索。
- 答案是否包含可解释的图路径。
- MDGraph 返回的上下文是否足够，无需进一步检查文件。
- 整个代理运行的时间和工具调用次数。
- `mdgraph eval` 指标：top-K 文档召回、预期章节召回、上下文精度、trace 成功率、延迟、返回字符数、预算适配、fanout、上下文多样性、reason 覆盖率和 ranking reason 覆盖率。
- `mdgraph eval` 排序报告：query mode、RRF 搜索融合通道、兼容上下文打包策略、可选 reranker 状态和 semantic-active case 数量。使用聚焦 context 回归套件对比可选真 MMR 和冻结默认策略。

A/B 报告入口是 `mdgraph report --benchmark benchmark-runs.json --json`。它消费结构化 run records 并报告 aggregate deltas；完整 transcript 应保留在公开文档之外。

## CJK 期望记录

`cjk` query set 是内置的中文/日文检索基线。它使用仓库测试 fixture `createCjkFixtureDocs` 中的期望记录，覆盖中文 design/API/runbook/spec 文档和一篇日文 design 文档。case 范围包括：

- 空格分隔的中文关键词查询，例如 `登录流程 缓存超时 认证重试`。
- 连续中文自然语言查询，例如 `缓存超时影响登录流程的处理`，该 case 由轻量 CJK n-gram 预处理覆盖。
- 混合 Latin/CJK 的 config key、API route、source ref 和日文 symbol 查询。

后续 CJK tokenizer、RRF/MMR 或 reranking 改动应和这个基线对比，但远程模型仍不应成为索引或搜索的必需路径。

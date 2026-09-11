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
  - src/wiki/wiki-evidence.ts
  - src/wiki/wiki-dependencies.ts
  - src/wiki/wiki-domains.ts
---

# Knowledge Card 与 Wiki 工作流

Knowledge Card 帮助定位和理解图证据。Wiki 命令负责规划、准备材料和检查维护状态，正文由宿主 Agent 或用户编写。两项功能均不依赖生成模型、向量模型、源码图或第二套数据库。

## Knowledge Card

CLI `node` 与 MCP `mdgraph_node` 返回实验性的 `card`。`context` 仅在原始 Markdown 装入后仍有空间时，加入完整的 `cardSummary`。搜索排名、trace 路径和五个 MCP 工具保持不变。

卡片保留 `nodeId`、`kind`、`label`、`summary`、`definitions`、`sourceRefs`、`relatedDocuments`、`evidence` 与可选的 `truncated`。新增的可选 `nextReads` 提供有数量上限的阅读位置和理由。

引用通过 `association` 区分 `direct`（直接）、`inherited`（继承）和 `related`（关联背景），同时保留 `originNodeId` 及可选的 `viaNodeId`。章节自身的事实为直接证据，所属文档的声明为继承背景。文档汇总章节事实时保留其来源节点。经实体定义或引用文档找到的源码属于关联背景，不代表实体直接实现了所有这些文件。

确定性摘要突出位置和关键关系，阅读建议来自实际图节点。默认整张卡片的 JSON 字符预算为 4,000，归属字段、阅读建议和截断说明均计入其中。裁剪时优先保留直接证据，展示文字可以用省略号结尾，但稳定节点身份保留。预算小到无法表示必需结构时明确报错。卡片不落库，也没有独立命令。

## 创建 Wiki 计划

```bash
mdgraph wiki plan --wiki-dir wiki --out .mdgraph/wiki-plan.json --path <project>
mdgraph wiki brief <page-id> --plan .mdgraph/wiki-plan.json --json --path <project>
```

Plan v2 记录项目相对的 Wiki 输出目录，并将该目录排除在来源选择之外。概览、架构、使用、开发、运维、参考是通用候选方向；项目文档提供实际标题和领域词汇。材料稀少时只提出有证据支持的页面，并报告缺口。

每页保留稳定 ID、输出路径、目的、读者、提纲、选定文档 ID、源码路径、证据查询和页面证据哈希。`dependencySnapshot` 保存文档与源码指纹，使维护检查能够指出具体变更文件。全局图哈希保留为诊断信息；索引时间等元数据变化不会要求全部页面重写。

## 更新已有计划

```bash
mdgraph wiki plan --from .mdgraph/wiki-plan.json --out .mdgraph/wiki-plan.next.json --path <project>
```

先审视新计划，再替换旧计划。更新会保留已有页面 ID、路径、层级、标题、目的、读者、提纲、文档、源码引用和查询。新增页面放入 `suggestions.pages`，既有页的新增文档与源码放入 `suggestions.sources`，不会自动改写人工选择。采纳建议时编辑对应页面字段，再刷新计划，然后按新 Brief 编写正文。已丢失的依赖仍然保留，并提供缺口说明。

v1 计划继续可读。用 `--from` 迁移时明确提供 `--wiki-dir wiki`，把 v2 结果写到新文件。未知的未来格式会得到诊断，输入文件保持原样。四个 Wiki 命令均不生成或覆盖正文。

## 编写一个页面

Brief 的 `sourceDocuments` 是计划选定的主要材料；`supplementaryDocuments` 是检索补充材料；`sourceInspections` 列出需要检查的源码；`evidenceGaps` 说明尚未解决的缺口。Knowledge Card 标记直接依据和背景信息。

`maxChars`／`usedChars` 计算装入的上下文文字及序列化卡片。页面指引和来源清单是单独的定位、恢复信息，因此这一预算不是整个 Brief JSON 的大小上限。

共享证据检查同时驱动 JSON、文本和写作要求。`strictFreshness` 表示索引与磁盘文档的状态，`dependencyEvidence` 表示本页选定依赖的状态。过期或未知的 Brief 仍可查看，但不会要求作者把旧哈希当成当前依据。按恢复指引刷新来源、索引和计划，再检查文件、编写正文。

维护字段示例：

```yaml
---
wiki_id: architecture
evidence_hash: "<当前 Brief 的哈希>"
source_docs:
  - docs/architecture.md
source_refs:
  - src/main.ts
---
```

两个来源字段必须是由非空项目相对路径组成的数组；没有来源时使用 `[]`。人工新增的来源应审视后纳入计划，不能仅为通过校验而删除引用。

详细操作见 [Wiki 编写工作流](../../agent-pack/skills/wiki-authoring/SKILL.md)。

## 状态、验证与正文验收

```bash
mdgraph wiki status wiki --plan .mdgraph/wiki-plan.json --json --path <project>
mdgraph wiki verify wiki --plan .mdgraph/wiki-plan.json --json --path <project>
```

`current` 表示记录的依赖和维护字段未发现变化。`needs_update`、`missing` 和 `orphaned` 分别提示需要更新、缺页和需要审视的额外页面。状态结果通过 `changes` 列出依赖变化，通过 `selectionChanges` 列出页面来源字段与计划的差异。增加无关文档可以使计划需要重新审视，但不会强迫无关页面重写。状态和验证均保留用户正文。

Verify 检查维护字段、来源、相对链接及证据一致性。`scope: maintenance-and-evidence` 和 `contentReview: not-evaluated` 明确检查范围。`valid: true` 不证明正文正确。正文验收应另外记录执行的任务、命令、结果、对应代码版本和未验证部分。

## 验证方法

回归测试覆盖归属、预算、过期证据、人工选择保留、格式兼容和完整更新流程。`npm run baseline:knowledge-wiki` 在果园调度示例上测量输出行为，不是独立 Agent A/B 实验，也不证明正文质量提升。`npm run baseline:performance` 测量 100／500 文档合成数据。

仓库中的 `wiki/` 手册与 `wiki/acceptance.md` 分别记录真实使用说明和验收结果；它们的验收与单元测试通过分开报告。

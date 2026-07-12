<div align="center">

# MDGraph

### 寥寥数语，万千尽显。

**MDGraph 把项目 Markdown 转成本地、可解释的图谱，让代理知道该读什么、文档如何关联，以及每条结果为什么重要。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/daoGEE/mdgraph/actions/workflows/ci.yml/badge.svg)](https://github.com/daoGEE/mdgraph/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/Node-%3E%3D22.5.0-brightgreen.svg)](https://nodejs.org/)
[![Release](https://img.shields.io/github/v/release/daoGEE/mdgraph?include_prereleases&label=release)](https://github.com/daoGEE/mdgraph/releases)

<a href="./README.md">English</a> · <a href="./docs/ZH/Architecture.md">架构说明</a> · <a href="./docs/ZH/Agent_Integration.md">Agent 集成</a> · <a href="./docs/ZH/Public_Contracts.md">公开契约</a> · <a href="./docs/ZH/Output_Contracts.md">输出契约</a>

</div>

---

## 不要再让代理反复考古同一套架构

答案通常已经在仓库里，只是分散在一条 ADR、一份设计文档、一段 API 说明，以及那篇没人想起来打开的 runbook 里。

文本搜索只能找到相同词语。MDGraph 会找到词语背后的决策、相关文档和它们之间的路径，再把结果压缩成一份带明确来源和入选原因的上下文。

```text
$ mdgraph context "Markdown 文件如何经过索引流程变成代理上下文？"

docs/EN/Architecture.md:49  ·  Indexing Flow
Reason: FTS5 content match; RRF fusion

1. scanMarkdownFiles 选择候选 Markdown 文件。
2. parseMarkdownDocument 读取 front matter 和文档结构。
3. buildGraphRecords 创建节点、chunks、vectors 和 edges。
4. GraphRepository 写入完整或增量更新。
```

一个问题，命中正确章节，还能看见原因——不是黑盒答案。

---

## 从安装到第一个答案

```bash
npm install -g @daogee/mdgraph
mdgraph init --path /path/to/your/project --docs "docs/**/*.md"
mdgraph context --path /path/to/your/project "哪些 ADR 限制了身份认证设计？"
```

`init` 会创建可跟踪的 `.mdgraph/config.json`，通过 `.gitignore` 保护本地图谱产物，并完成第一次索引。Markdown 和 SQLite 图谱都留在你的机器上。

### 连接 AI 编码代理

```json
{
  "mcpServers": {
    "mdgraph": {
      "type": "stdio",
      "command": "mdgraph",
      "args": [
        "serve",
        "--mcp",
        "--path",
        "/absolute/path/to/project"
      ]
    }
  }
}
```

服务会在启动时索引一次，并随 Markdown 变化保持图谱最新。如果 MCP 宿主没有继承终端的 `PATH`，请把 `mdgraph` 替换为 `which mdgraph`（macOS/Linux）或 `where mdgraph`（Windows）返回的绝对路径。

---

## 五个工具，一层完整的文档上下文

| 当代理需要…… | 它调用…… | 得到什么 |
|---|---|---|
| 找到决策、命令、路径、API 或错误 | `mdgraph_search` | 带匹配原因的排序结果 |
| 带着正确文档开始任务 | `mdgraph_context` | 受预算约束、有来源的上下文包 |
| 查看已知文档、章节或实体 | `mdgraph_node` | 已解析节点和来源信息 |
| 理解两个对象如何连接 | `mdgraph_trace` | 可解释的图谱路径 |
| 判断结果是否足够新鲜 | `mdgraph_status` | 索引可用性和新鲜度 |

MDGraph 从标题、front matter、Markdown 链接、WikiLink、内联代码、代码块和显式 source refs 中提取关系。核心索引是确定性的：不依赖 LLM 生成摘要，也不要求远程 embedding 服务。

---

## 填补“搜到词语”和“理解项目”之间的空白

| 工具 | 最擅长 | MDGraph 补充什么 |
|---|---|---|
| `grep` / 文件搜索 | 精确文本和快速临时查找 | 文档关系、排序后的上下文、来源和新鲜度 |
| 向量 RAG | 在广泛内容中做模糊语义匹配 | 无需远程模型的确定性提取和本地检索 |
| 源代码图谱 | 符号、调用和实现结构 | 决策、runbook、规格说明等 Markdown 知识 |

MDGraph 不替代这些工具。它提供的是文档上下文层：补上源码本身无法承载的设计意图、架构决策、运维知识和跨文档关系。

### 给出证据，也保留证据的边界

- 仓库自有评估 fixtures 覆盖 ADR、设计、API、runbook、incident、source refs、被取代文档和 CJK 检索。
- 每个 search 和 context 结果都保留匹配原因；graph trace 保留边类型、来源和置信度。
- Linux 和 Windows 运行完整 CI 门禁，macOS 运行构建和包产物冒烟检查。
- `1.0.0` 的公开 CLI、MCP、配置、JSON 和 schema 已有明确兼容性基线。

这些是确定性的工程检查，不代表已经完成真实代理 benchmark。方法和限制详见[评估问题](./docs/ZH/Evaluation_Questions.md)和 [1.0 公开契约](./docs/ZH/Public_Contracts_1.0.md)。

---

## 常用命令

```bash
# 手动刷新图谱
mdgraph index --path /your/project

# 检查可用性、计数和新鲜度
mdgraph status --freshness --path /your/project

# CLI 搜索和上下文打包
mdgraph search --path /your/project "authentication timeout"
mdgraph context --path /your/project "why does RedisTimeoutError affect login"

# 解析单个节点或追溯图谱路径
mdgraph node --path /your/project "AuthService"
mdgraph trace --path /your/project "AuthService" "RedisTimeoutError"

# 文档健康检查
mdgraph doctor --path /your/project
mdgraph doctor --since origin/main --fail-on warn --json --path /your/project

# Agent 友好的使用指引
mdgraph usage --path /your/project
```

完整 CLI 参考请使用 `mdgraph help` 或 `mdgraph help <command>`。

---

## 为什么团队可以信任它

- **默认留在本地。** Markdown、chunks、vectors 和 SQLite 产物都保留在项目环境中。
- **从设计上可解释。** 查询结果在相关位置保留匹配原因、实体、边来源、置信度、路径和预算信息。
- **核心流程确定性。** 同一份 Markdown 无需 LLM 即可生成稳定的图谱记录。
- **活跃工作中持续新鲜。** 基于哈希的增量索引只更新变化文档，MCP watch mode 让后续查询保持最新。
- **不回避风险。** `doctor` 会暴露失效链接、过期 source refs、缺失定义、内容风险、存储健康和陈旧索引。

---

## 文档导航

- `docs/ZH/Architecture.md` — 流水线、模块边界、数据流和取舍。
- `docs/ZH/Agent_Integration.md` — MCP 配置、共享 agent 指令和宿主说明。
- `docs/ZH/Public_Contracts.md` — 稳定公开表面、兼容策略和发布门禁。
- `docs/ZH/Public_Contracts_1.0.md` — 1.0 契约冻结附录，列出当前 `1.0.0` 基线下冻结的 CLI、配置、MCP、JSON 与 schema 清单。
- `docs/ZH/Output_Contracts.md` — CLI 和 MCP 消费者使用的 JSON 输出形状。
- `docs/ZH/Evaluation_Questions.md` — 检索与评估问题。
- `docs/ZH/Release_Checklist.md` — 发布验证清单。
- `agent-pack/` — 可复用 MCP 配置、指令和 prompt 模板。

---

## 社区参与

- 发现 bug 或有聚焦的功能建议？[提交 Issue](https://github.com/daoGEE/mdgraph/issues/new/choose)。
- 想改进 MDGraph？请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。
- 发现安全问题？请按 [SECURITY.md](./SECURITY.md) 私下报告，不要公开敏感细节。
- 如果 MDGraph 对你的团队有帮助，欢迎 Star 仓库并分享实际工作流；真实案例是路线图最有价值的输入。

---

## 环境要求

- Node.js `>=22.5.0`
- Node 内置 `node:sqlite` 支持
- 本地项目目录中的 Markdown 文件

当前 Node 版本可能会打印 `node:sqlite` 实验性警告。只要命令成功退出，该警告可视为信息提示。

---

## 开发

```bash
npm install
npm run typecheck
npm test
npm run build
```

常用 smoke checks：

```bash
npm run smoke:cli
npm run smoke:eval
npm run smoke:pack
npm run task:public-check
```

---

## 许可证

MIT

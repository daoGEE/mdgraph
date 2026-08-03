# MDGraph 文档

[English](../EN/README.md)

MDGraph 文档按用户任务组织。安装和首次查询请从仓库的 [中文 README](https://github.com/daoGEE/mdgraph/blob/main/README-ZH.md) 开始，再根据当前任务选择对应指南。

## 使用 MDGraph

- [Agent 集成](Agent_Integration.md) — 将 MDGraph 连接到 MCP 宿主，并为编码代理提供可靠的文档工作流。
- [检索与上下文](Retrieval_and_Context.md) — 理解搜索通道、可选语义 provider、实体抽取、CJK 处理和上下文打包。
- [结构化查询与派生关系](Structured_Query_and_Relationships.md) — 执行治理查询，并显式派生非权威的相关文档边。
- [运行与故障处理](Operations.md) — 保持索引新鲜、解释 watcher 健康状态、安全使用 polling，并处理 provider 或文件监听故障。

## 集成与维护 MDGraph

- [架构](Architecture.md) — 已实现的流水线、模块边界、数据模型与取舍。
- [输出契约](Output_Contracts.md) — CLI 与 MCP 的机器可读结果形状。
- [公开契约](Public_Contracts.md) — 兼容性标签与当前公开边界。
- [1.0 契约冻结](Public_Contracts_1.0.md) — 稳定 1.0 基线的版本化清单。
- [评估](Evaluation_Questions.md) — 公开评估命令、参考问题与仓库回归套件。
- [发布清单](Release_Checklist.md) — GitHub 与 npm 发布的维护者检查项。

实验性命令会在对应指南和输出契约中明确标记。它们不会改变确定性的默认索引流水线、稳定的 `search` 命令或五工具 MCP surface。

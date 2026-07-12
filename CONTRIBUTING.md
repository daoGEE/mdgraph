# Contributing to MDGraph

Thanks for helping make project documentation more useful to coding agents.

## Before You Start

- Search [existing issues](https://github.com/daoGEE/mdgraph/issues) before opening a new one.
- For a bug, include the smallest Markdown fixture and command that reproduce it.
- For a feature, explain the coding-agent workflow it improves. MDGraph intentionally stays a local-first Markdown document graph rather than a general RAG platform or source-code graph.
- For a large or contract-changing proposal, open an issue before investing in an implementation.

## Development Setup

MDGraph requires Node.js `>=22.5.0`.

```bash
git clone https://github.com/daoGEE/mdgraph.git
cd mdgraph
npm install
npm run typecheck
npm test
npm run build
```

Node may print an experimental warning for `node:sqlite`. If the command exits successfully, the warning is informational.

## Pull Requests

Keep changes focused and preserve the pipeline boundaries described in [Architecture.md](./docs/EN/Architecture.md).

- Add focused Vitest coverage for new features and regressions.
- Update English and Chinese docs together when public behavior changes.
- Preserve deterministic parsing, stable ordering, explainable provenance, and local-only core operation.
- Run `npm run typecheck` and the relevant tests. For broad or public changes, also run `npm test`, `npm run build`, and the appropriate smoke checks.
- Run `npm run task:public-check` before publishing a branch.

The repository's [AGENTS.md](./AGENTS.md) contains the complete development and verification rules.

## Good First Contributions

Useful small contributions include:

- Reproducible parser or link-resolution edge cases.
- Documentation fixes and clearer host integration examples.
- Focused tests for Windows, macOS, CJK, front matter, WikiLinks, and MCP behavior.
- Sanitized reports of real repositories where retrieval was helpful or weak.

Please do not include private documents, local graph databases, secrets, full agent transcripts, or personal machine paths in an issue or pull request.

## 中文说明

欢迎贡献。提交前请先搜索现有 Issue；Bug 请附最小 Markdown 复现和命令；较大功能或会改变公开契约的提案请先开 Issue 讨论。公开行为变化需要同步更新中英文文档，并按上面的命令完成验证。请勿上传私有文档、`.mdgraph/graph.db`、密钥、完整代理对话或个人路径。

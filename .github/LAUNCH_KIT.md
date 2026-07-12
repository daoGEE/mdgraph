# MDGraph Launch Kit

Maintainer-facing copy and rollout plan for [daoGEE/mdgraph](https://github.com/daoGEE/mdgraph). Update evidence and version numbers when the product changes.

## Positioning

**One sentence**

MDGraph turns project Markdown into a local, explainable graph that AI coding agents can search, trace, and context-pack through MCP.

**The problem**

Coding agents repeatedly search and reread specs, ADRs, runbooks, and design docs. Exact text search misses relationships; broad retrieval can return context without a clear reason or provenance.

**The differentiator**

MDGraph is deliberately narrow: Markdown documentation, deterministic extraction, SQLite storage, explainable results, five MCP tools, and no required cloud or LLM indexing service.

**Best-fit users**

- Teams with documentation-heavy repositories and AI coding workflows.
- Maintainers who need agents to connect ADRs, specs, runbooks, API notes, and source references.
- Users who prefer local data and interpretable retrieval over mandatory remote embeddings.

**Not positioned as**

- A general-purpose RAG platform or personal knowledge base.
- A source AST, call graph, or code-search replacement.
- Hidden agent memory or an autonomous documentation authority.

## GitHub Repository Settings

Suggested description:

> Local-first, explainable Markdown document graph for AI coding agents — deterministic indexing, SQLite, and MCP.

Suggested topics:

`markdown`, `knowledge-graph`, `mcp`, `model-context-protocol`, `ai-agents`, `coding-agents`, `local-first`, `sqlite`, `developer-tools`, `documentation`

Also verify manually:

- The `v1.0.0` release is marked as the latest release and has concise release notes.
- Issues and private vulnerability reporting are enabled.
- The social preview image is readable at small sizes and communicates “Markdown → Graph → Agent Context”.
- The repository website field points to the most useful demo or documentation page if one becomes available.

## Verified Demo Asset

This release-owned example is safe to reuse in launch posts. It was rerun after publishing `1.0.0`:

```bash
mdgraph trace "docs/EN/Architecture.md" "src/query/context-builder.ts" --json
```

```json
{
  "from": "MDGraph Architecture",
  "to": "src/query/context-builder.ts",
  "found": true,
  "steps": [
    {
      "edgeKind": "IMPLEMENTS",
      "traversalDirection": "forward",
      "confidence": 1,
      "provenance": "frontmatter"
    }
  ]
}
```

What this proves: MDGraph can connect an architecture document to an implementation path while retaining the relationship kind, direction, confidence, and provenance. What it does not prove: source-code AST analysis, automatic correctness of the documentation, or a general real-agent benchmark.

## English Launch Post

### Show HN / forum version

Title:

> Show HN: MDGraph – a local, explainable Markdown graph for AI coding agents

Body:

> I built MDGraph because coding agents in documentation-heavy repositories kept rediscovering the same ADRs, runbooks, and design relationships.
>
> MDGraph indexes project Markdown into a local SQLite graph and exposes five MCP tools for search, context packing, node inspection, relationship tracing, and freshness checks. Extraction is deterministic: headings, links, WikiLinks, front matter, code, and explicit source references. It does not require a cloud account, remote embeddings, or LLM-generated summaries.
>
> The repository ships deterministic evaluation fixtures covering ADRs, designs, APIs, runbooks, incidents, source references, superseded documents, and CJK retrieval. Results include reasons and provenance; these are engineering checks rather than a claimed real-agent benchmark.
>
> The project is MIT licensed and reached 1.0. I would especially value feedback from people using MCP-capable coding agents in repositories with substantial Markdown: where does the setup feel heavy, and which documentation relationships are still missed?
>
> Quick start: `npm install -g @daogee/mdgraph`
>
> GitHub: https://github.com/daoGEE/mdgraph
> npm: https://www.npmjs.com/package/@daogee/mdgraph

### Short social version

> Released MDGraph 1.0: a local-first Markdown document graph for AI coding agents.
>
> - deterministic Markdown → SQLite graph
> - explainable search, context, and relationship traces
> - 5 MCP tools
> - no required cloud or LLM indexing service
> - repository-owned deterministic evaluation fixtures
>
> Install: `npm install -g @daogee/mdgraph`
>
> Try it and tell me where your agent still gets lost: https://github.com/daoGEE/mdgraph

## 中文发布文案

### V2EX / 掘金 / 知乎版本

标题：

> 我做了 MDGraph：让 AI 编码代理先理解项目文档关系，再开始读代码

正文：

> 在文档较多的仓库里，AI 编码代理经常反复搜索 ADR、设计文档和 runbook。普通文本搜索能找到相同词语，却很难回答“这个设计依赖哪条决策”“这个错误对应哪个处理手册”“为什么返回这段上下文”。
>
> MDGraph 会把项目 Markdown 确定性地索引成本地 SQLite 图谱，并通过 5 个 MCP 工具提供搜索、上下文打包、节点查看、关系追溯和新鲜度检查。索引信息来自标题、链接、WikiLink、front matter、代码和显式 source refs；核心流程不要求云服务、远程 embedding 或 LLM 生成摘要。
>
> 仓库自带确定性评估 fixtures，覆盖 ADR、设计、API、runbook、incident、source refs、被取代文档和 CJK 检索。查询结果保留匹配原因和来源；这些是工程检查，不包装成真实代理 benchmark。
>
> 项目采用 MIT 协议，当前已到 1.0。特别想听听正在用 Codex、Claude Code、Cursor、Copilot 或其他 MCP 客户端的朋友反馈：安装哪一步最麻烦？你的项目文档里还有哪些关系无法被识别？
>
> 快速安装：`npm install -g @daogee/mdgraph`
>
> GitHub：https://github.com/daoGEE/mdgraph
> npm：https://www.npmjs.com/package/@daogee/mdgraph

### 短版

> MDGraph 1.0 发布：把项目 Markdown 转成本地、可解释的文档图谱，让 AI 编码代理通过 MCP 搜索、打包上下文和追溯关系。
>
> 确定性索引、SQLite、本地优先，不强制依赖云服务或 LLM 摘要，并提供仓库自有评估 fixtures。
>
> 安装：`npm install -g @daogee/mdgraph`
>
> 欢迎试用和反馈：https://github.com/daoGEE/mdgraph

## Four-Week Rollout

### Week 1: Conversion baseline

- Publish the improved README and community files.
- Update the GitHub description, topics, social preview, and latest release notes.
- Ask 3–5 trusted coding-agent users to follow the five-minute quick start while observing where they stop.
- Record baseline views, unique cloners, stars, issues, and successful setup reports.

### Week 2: Launch

- Publish one detailed English post and one detailed Chinese post; adapt the same evidence instead of posting identical copy everywhere.
- Reply to every substantive question with concrete setup help.
- Turn repeated confusion into README fixes within 48 hours.

### Week 3: Proof

- Publish one real, sanitized repository workflow: question, MDGraph result, files avoided or selected, and limitations.
- Invite users to submit small reproducible retrieval failures or integration notes through the issue templates.
- Add confirmed third-party integrations or testimonials only with permission.

### Week 4: Iterate

- Compare the funnel: repository views → quick-start attempts → successful query → MCP connection → repeat use.
- Prioritize the largest observed drop-off, usually install friction, unclear host configuration, or insufficient proof.
- Publish a short “what we learned” update and the next focused improvement.

## Metrics That Matter

Stars are useful discovery signals, but adoption needs stronger evidence. Review weekly:

- GitHub unique visitors and unique cloners.
- Quick-start completions reported by testers or users.
- MCP setup completions by host.
- Issues containing real workflows or reproducible retrieval gaps.
- Returning contributors and downstream repositories mentioning MDGraph.
- Time from clone to first successful `context` result.

Do not claim download numbers until MDGraph has a package or release-asset distribution path that measures them reliably.

## npm Distribution

The unscoped npm name `mdgraph` belongs to another project. MDGraph uses the maintainer-controlled public package `@daogee/mdgraph` while keeping the installed CLI command `mdgraph`.

Before each release:

1. Confirm the package version matches the Git tag and changelog.
2. Run typecheck, tests, build, CLI smoke, and pack smoke.
3. Inspect `npm pack --dry-run` for unexpected or missing files.
4. Publish through npm trusted publishing from the authorized GitHub Actions workflow when configured.
5. Verify global installation, `mdgraph --version`, the quick start, and MCP startup from a clean environment.

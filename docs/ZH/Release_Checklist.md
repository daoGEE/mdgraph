# MDGraph 发布清单

在发布 MDGraph 或请求维护者切 release 前使用此清单。它补充 [CHANGELOG.md](../../CHANGELOG.md)、[Output_Contracts.md](Output_Contracts.md)、[Public_Contracts.md](Public_Contracts.md) 和 task public check。

## 公开检查

- 确认公开 package 为 `@daogee/mdgraph`、安装后的 binary 仍为 `mdgraph`，并且 `package.json` / CLI 版本与 release tag 一致。
- Tag 前把 [CHANGELOG.md](../../CHANGELOG.md) 中与本次发布相关的 `Unreleased` 条目提升为带日期、且版本号与 `package.json` 一致的正式版本。
- 当公开 CLI/MCP 行为变化时，复查 README quick start、运行要求、MCP setup、输出契约、公开契约标签和已知 tradeoff。
- 确认 GitHub 仓库仍公开 `README.md`、`LICENSE`、`CONTRIBUTING.md`、`SECURITY.md`、Issue templates 与 PR template；公开发布前复查 GitHub community profile。

## 契约门槛

- 确认 [Public_Contracts.md](Public_Contracts.md) 为每个被触及的 public surface 标注 `stable`、`stable-additive`、`experimental`、`reserved` 或 `internal`。
- 确认 focused contract tests 覆盖 MCP tool definitions、代表性 JSON fields、edge kinds、doctor warning shape、config defaults 和 schema compatibility guidance。
- 已经返回结构化错误的命令，应确认错误输出包含稳定 `code` 和 remediation。
- 确认实验性命令在使用指南、公开 ledger、输出契约和 release notes 中保持明确标记。

## 证据门槛

- 确认 [Public_Contracts.md](Public_Contracts.md) 将 context recovery fields 标注为 `stable-additive`。
- 确认 context、MCP 和 contract tests 覆盖 `nodeId`、`documentId`、可选 `sectionId`、可选 `anchor` 和 graph-expansion `edgePath`。
- 确认 `smoke:cli` 使用仓库自有 fixture 覆盖多问题结构化 benchmark。
- 除非单独 release 明确冻结，否则确认 optional semantic 行为仍保持 experimental。
- 运行聚焦的词法历史、实体、上下文、结构化查询和派生关系回归套件。已记录历史数值是不可改写的比较证据，不是当前产品目标。

## 兼容门槛

- 确认已知 output-shape 不一致已经规范化，或被明确记录为刻意保留。
- 确认 `context --json` 和 MCP `mdgraph_context.structuredContent` 暴露恢复字段（`nodeId`、`documentId`、可选 `sectionId`、可选 `anchor` 和 graph-expansion `edgePath`），方便 agent 交接到 `node`、`trace` 和 raw Markdown。
- 确认 Node.js `>=22.5.0` 仍是支持下限，且当前 release 已在当前 Node 22.x 上测试。
- 确认 Linux 和 Windows full CI 行通过。确认 macOS CI smoke 行通过 build-output CLI 和 packed-artifact smoke。
- 对 CI 有意不自动覆盖的平台相关长运行 surface 执行 maintainer smoke：在相关目标 OS 上运行 `serve --mcp` 和 `watch`。
- 确认 release notes 将兼容承诺与功能新增分开说明。
- 确认新行为没有静默改变冻结的 1.0 默认值、五工具 MCP surface、schema version 或 `alpha | cjk` evaluation enum。

## 命令门槛

安装依赖后，从仓库根目录运行：

```bash
npm run typecheck
npm run docs:check
npm run build
npm run test:run
npm run baseline:historical
npm run baseline:entity-extraction
npm run baseline:context-packing
npm run baseline:structured-query
npm run baseline:related-documents
npm run smoke:cli
npm run smoke:eval
npm run smoke:pack
npm run smoke:clean
node dist/bin/mdgraph.js index --json
node dist/bin/mdgraph.js doctor --strict --json
node dist/bin/mdgraph.js status --storage --json
node dist/bin/mdgraph.js bundle create --profile private --json
node dist/bin/mdgraph.js bundle verify BUNDLE_DIR_FROM_CREATE_OUTPUT --json
node dist/bin/mdgraph.js report --json --eval --bundle BUNDLE_DIR_FROM_CREATE_OUTPUT
node dist/bin/mdgraph.js diff --base HEAD --json
node dist/bin/mdgraph.js report --json --base HEAD
node dist/bin/mdgraph.js report --json --benchmark PATH_TO_BENCHMARK_RUN_RECORDS
npm run task:public-check
git diff --check
```

预期结果：

- 文档链接、typecheck、tests、build、聚焦回归套件、CLI smoke 和 pack smoke 均以 0 退出。
- `doctor --strict --json` 对 MDGraph 仓库报告 `staleIndex: 0`，且没有问题计数。
- `status --storage --json` 返回 `{ counts, storage }`，并包含 database、object、path group、edge kind、high-degree node 和 vector 信息。
- `bundle create`、`bundle verify` 和 `report --json --eval --bundle` 为当前仓库索引返回有效的私有工作流 artifact。
- `diff --base` 和 `report --base` 返回 documentation graph impact summary，且不会替换当前 index。
- `report --benchmark` 为多问题 smoke set 返回 paired run-record delta，将不完整 pair 报告为 skipped，并且不需要 transcript 或 agent/model 执行。
- `task:public-check` 不应发现 `docs/tasks/` 下除允许公开文件外的已跟踪任务工件。
- `git diff --check` 干净。Windows CRLF 文件如出现未改动行尾误报，可设置仓库本地 `core.whitespace=cr-at-eol`。
- 私有或第三方评估语料必须保留在 release artifacts 和公开 fixtures 之外。
- macOS CI 行仅作 smoke，不替代完整命令门槛，也不替代 MCP server、watcher 和 external-corpus 行为的 maintainer 检查。

## Package 门槛

- Package metadata 或公开文档变化时，使用 `npm pack --dry-run --json` 检查机器可读的 tarball 内容。
- 确认 npm Trusted Publishing 已绑定 `daoGEE/mdgraph` 和准确的 workflow 文件名 `publish.yml`，并允许 `npm publish`。
- 通过推送与 `package.json` 版本一致的 `v*` 标签发布；`.github/workflows/publish.yml` 使用 GitHub Actions OIDC，不需要长期 npm token。
- 确认 package 包含 `dist`、agent pack、两份 README、`CHANGELOG.md`、`LICENSE` 和显式 allowlist 中的中英文指南。
- 确认 package 不包含编号实施阶段文档、内部实施 ADR、`docs/tasks/`、`.mdgraph/`、本地数据库、`.DS_Store`、临时输出或外部工作区内容。
- 发布前在干净的临时 prefix 中全局安装打包 tarball，并验证 `mdgraph --version`、`init` 和一个代表性查询。
- 运行 `npm run smoke:pack`；它会验证 runtime/type consumer，并拒绝 tarball 中的实施阶段文档。

## Release notes 文案

- 总结用户可见的 CLI/MCP 行为变化。
- 明确指出输出契约变化。
- 仅把已知 `node:sqlite` experimental warning 描述为非失败运行时 warning。
- 将外部 alpha warning 与 MDGraph 仓库发布阻塞项分开。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { indexProject, loadConfig, openDatabase, GraphRepository, buildKnowledgeCard, buildContext, searchGraph } from "../dist/index.js";

const sizes = (process.argv[2] ?? "100,500").split(",").map(Number);
if (sizes.some((size) => !Number.isSafeInteger(size) || size < 1 || size > 10_000)) throw new Error("Use comma-separated corpus sizes from 1 to 10000.");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-performance-"));
const measurements = [];
for (const size of sizes) {
  const project = path.join(root, String(size)); fs.mkdirSync(project, { recursive: true });
  for (let i = 0; i < size; i++) {
    fs.writeFileSync(path.join(project, `doc-${i}.md`), `---\ndefines: [Service${i}]\n---\n# Service ${i}\n\nService${i} handles indexing and retrieval.\n\n## Recovery\nRetry documentation queries after configuration changes.\n`);
  }
  const initial = performance.now(); await indexProject(project, { semantic: true });
  const fullIndexMs = performance.now() - initial;
  fs.appendFileSync(path.join(project, "doc-0.md"), "\nAdditional recovery guidance.\n");
  const incremental = performance.now(); await indexProject(project, { semantic: true });
  const incrementalIndexMs = performance.now() - incremental;
  const repository = new GraphRepository(openDatabase(project));
  try {
    const config = loadConfig(project);
    const timings = {};
    for (const [name, run] of Object.entries({
      card: () => buildKnowledgeCard(repository, repository.resolveNode("doc-0.md")),
      context: () => buildContext(repository, config, "Service0 recovery"),
      semanticSearch: () => searchGraph(repository, config, "recovery guidance", 8, { semantic: true })
    })) {
      run();
      const samples = Array.from({ length: 5 }, () => { const started = performance.now(); run(); return performance.now() - started; }).sort((a, b) => a - b);
      timings[`${name}MedianMs`] = Number(samples[2].toFixed(2));
    }
    measurements.push({ documents: size, counts: repository.counts(), fullIndexMs: Number(fullIndexMs.toFixed(2)), incrementalIndexMs: Number(incrementalIndexMs.toFixed(2)), ...timings, heapUsedBytes: process.memoryUsage().heapUsed, rssBytes: process.memoryUsage().rss });
  } finally { repository.close(); }
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, fixtureRoot: root, methodology: "Synthetic two-section documents; local-hash vectors; one warmup and five query samples; memory is process memory after operations, not peak allocation; fixtures retained for inspection.", measurements }, null, 2));

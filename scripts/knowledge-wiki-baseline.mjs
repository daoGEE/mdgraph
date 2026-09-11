import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { indexProject, openDatabase, GraphRepository, buildKnowledgeCard, buildWikiPlan, buildWikiPageBrief, loadConfig } from "../dist/index.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-knowledge-wiki-baseline-"));
fs.mkdirSync(path.join(root, "docs"));
fs.mkdirSync(path.join(root, "src"));
fs.writeFileSync(path.join(root, "README.md"), "# Orchard Scheduler\n\nSchedule irrigation for orchard zones. Install with npm and configure the watering timetable.\n");
fs.writeFileSync(path.join(root, "docs", "architecture.md"), "---\ntype: design\ndefines: [OrchardScheduler]\nsource_refs: [src/scheduler.ts]\n---\n# Irrigation Architecture\n\nThe scheduler coordinates watering zones.\n\n## Timing\n\nWater each zone at its configured time.\n\n## Recovery\n\nResume unfinished watering after a restart.\n");
fs.writeFileSync(path.join(root, "src", "scheduler.ts"), "export const schedule = () => [];\n");
await indexProject(root);
const repository = new GraphRepository(openDatabase(root));
try {
  const targets = ["docs/architecture.md#timing", "OrchardScheduler", "src/scheduler.ts"];
  const cards = targets.map((target) => {
    const started = performance.now();
    const card = buildKnowledgeCard(repository, repository.resolveNode(target));
    const expectedPath = target.includes("#") ? "docs/architecture.md" : target === "OrchardScheduler" ? "docs/architecture.md" : "docs/architecture.md";
    const paths = (card.nextReads ?? []).map((item) => item.path);
    return {
      target,
      chars: JSON.stringify(card).length,
      elapsedMs: Number((performance.now() - started).toFixed(2)),
      firstCorrectNextReadRank: paths.includes(expectedPath) ? paths.indexOf(expectedPath) + 1 : null,
      definitionsWithoutAssociation: card.definitions.filter((item) => !item.association).length,
      sourceRefsWithoutAssociation: card.sourceRefs.filter((item) => !item.association).length,
      card
    };
  });
  const plan = buildWikiPlan(root, repository);
  const briefs = plan.pages.map((page) => {
    const brief = buildWikiPageBrief(root, repository, loadConfig(root), plan, page.id);
    return { pageId: page.id, usedChars: brief.usedChars, sourcePaths: brief.sourceDocuments.map((source) => source.path) };
  });
  console.log(JSON.stringify({ node: process.version, fixtureRoot: root, methodology: "Deterministic orchard-project fixture; next-read rank and association coverage measure output behavior, not independent agent accuracy or completion time. Null rank means no matching next-read entry. Timings are single local samples.", cards, plan, briefs }, null, 2));
} finally { repository.close(); }

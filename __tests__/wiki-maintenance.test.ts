import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { indexProject } from "../src/indexer.js";
import { GraphRepository } from "../src/db/repositories.js";
import { openExistingDatabase } from "../src/db/connection.js";
import { loadConfig } from "../src/config/load-config.js";
import { buildWikiPlan, buildWikiPageBrief, type WikiPlan, type WikiPlanPage } from "../src/wiki/wiki-plan.js";
import { buildWikiStatus, verifyWiki } from "../src/wiki/wiki-status.js";

it("completes a dependency update without changing unaffected prose", async () => {
  const root = await fixture();
  let repository = new GraphRepository(openExistingDatabase(root));
  const plan = buildWikiPlan(root, repository);
  writePages(root, plan, repository);
  const before = fs.readFileSync(path.join(root, "wiki/index.md"), "utf8");
  expect(verifyWiki(root, repository, path.join(root, "wiki"), plan)).toMatchObject({ valid: true, scope: "maintenance-and-evidence", contentReview: "not-evaluated" });
  fs.appendFileSync(path.join(root, "src/irrigation.ts"), "export const retry = true;\n");
  const status = buildWikiStatus(root, repository, path.join(root, "wiki"), plan);
  expect(status.pages.find((page) => page.id === "architecture")).toMatchObject({ state: "needs_update", changes: [{ kind: "source_ref", path: "src/irrigation.ts", reason: "modified" }] });
  expect(status.pages.find((page) => page.id === "project-overview")?.state).toBe("current");
  const stale = buildWikiPageBrief(root, repository, loadConfig(root), plan, "architecture");
  expect(stale.strictFreshness.state).toBe("fresh");
  expect(stale.dependencyEvidence.state).toBe("stale");
  expect(stale.writingRequirements.some((line) => line.startsWith("Set evidence_hash"))).toBe(false);
  repository.close();
  await indexProject(root);
  repository = new GraphRepository(openExistingDatabase(root));
  try {
    const next = buildWikiPlan(root, repository, { from: plan });
    expect(buildWikiStatus(root, repository, path.join(root, "wiki"), next).pages.find((page) => page.id === "architecture")?.state).toBe("needs_update");
    const brief = buildWikiPageBrief(root, repository, loadConfig(root), next, "architecture");
    expect(brief.dependencyEvidence.state).toBe("fresh");
    expect(brief.sourceInspections.map((source) => source.path)).toContain("src/irrigation.ts");
    expect(brief.usedChars).toBe(brief.contextItems.reduce((sum, item) => sum + item.content.length + (item.cardSummary?.length ?? 0), 0) + brief.knowledgeCards.reduce((sum, card) => sum + JSON.stringify(card).length, 0));
    writePage(root, brief.page, repository, "Reviewed irrigation retry behavior.");
    expect(verifyWiki(root, repository, path.join(root, "wiki"), next).valid).toBe(true);
    expect(fs.readFileSync(path.join(root, "wiki/index.md"), "utf8")).toBe(before);
  } finally { repository.close(); }
});

it("preserves user-selected sources and provides a successful adoption path", async () => {
  const root = await fixture();
  const repository = new GraphRepository(openExistingDatabase(root));
  try {
    const plan = buildWikiPlan(root, repository);
    writePages(root, plan, repository);
    const page = plan.pages.find((page) => page.id === "architecture")!;
    const file = path.join(root, "wiki", page.path);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('source_refs: ["src/irrigation.ts"]', 'source_refs: ["src/irrigation.ts","src/extra.ts"]'));
    const raw = fs.readFileSync(file, "utf8");
    const status = buildWikiStatus(root, repository, path.join(root, "wiki"), plan);
    const changed = status.pages.find((candidate) => candidate.id === page.id)!;
    expect(changed).toMatchObject({ state: "needs_update", selectionChanges: [{ field: "source_refs", added: ["src/extra.ts"], missing: [] }] });
    expect(changed.recovery).toContain("add intended sources");
    expect(fs.readFileSync(file, "utf8")).toBe(raw);
    const selected = { ...plan, pages: plan.pages.map((candidate) => candidate.id === page.id ? { ...candidate, sourceRefs: [...candidate.sourceRefs, "src/extra.ts"] } : candidate) };
    const next = buildWikiPlan(root, repository, { from: selected });
    writePage(root, next.pages.find((candidate) => candidate.id === page.id)!, repository, "Reviewed both source files.");
    expect(verifyWiki(root, repository, path.join(root, "wiki"), next).valid).toBe(true);
  } finally { repository.close(); }
});

async function fixture(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-wiki-maintenance-"));
  fs.mkdirSync(path.join(root, "docs")); fs.mkdirSync(path.join(root, "src")); fs.mkdirSync(path.join(root, "wiki"));
  fs.writeFileSync(path.join(root, "README.md"), "# Orchard\n\nSchedule watering.\n");
  fs.writeFileSync(path.join(root, "docs/Architecture.md"), "---\ntype: design\nsource_refs: [src/irrigation.ts]\n---\n# Irrigation Architecture\n\nWater zones on schedule.\n");
  fs.writeFileSync(path.join(root, "src/irrigation.ts"), "export const water = true;\n");
  fs.writeFileSync(path.join(root, "src/extra.ts"), "export const extra = true;\n");
  await indexProject(root); return root;
}
function writePages(root: string, plan: WikiPlan, repository: GraphRepository) { for (const page of plan.pages) writePage(root, page, repository, "Maintained text."); }
function writePage(root: string, page: WikiPlanPage, repository: GraphRepository, prose: string) {
  const docs = new Map(repository.allDocuments().map((document) => [document.id, document.path]));
  fs.writeFileSync(path.join(root, "wiki", page.path), `---\nwiki_id: ${page.id}\nevidence_hash: ${page.evidenceHash}\nsource_docs: ${JSON.stringify(page.documentIds.map((id) => docs.get(id)))}\nsource_refs: ${JSON.stringify(page.sourceRefs)}\n---\n# ${page.title}\n\n${prose}\n`);
}

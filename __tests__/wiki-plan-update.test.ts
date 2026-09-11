import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { openExistingDatabase } from "../src/db/connection.js";
import { GraphRepository } from "../src/db/repositories.js";
import { indexProject } from "../src/indexer.js";
import { buildWikiPlan, validateWikiPlan } from "../src/wiki/wiki-plan.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

it("upgrades a v1 plan only with wikiDir and preserves selected page fields", async () => {
  const root = fixture();
  await indexProject(root, { full: true });
  const repository = new GraphRepository(openExistingDatabase(root));
  try {
    const current = buildWikiPlan(root, repository);
    const v1 = { ...current, formatVersion: 1 as const };
    delete v1.wikiDir;
    delete v1.suggestions;
    for (const page of v1.pages) delete page.dependencySnapshot;
    const old = validateWikiPlan(v1);
    expect(() => buildWikiPlan(root, repository, { from: old })).toThrow(/wikiDir/);
    const selected = { ...old.pages[0], title: "Maintainer title", documentIds: old.pages[0].documentIds.slice(0, 1) };
    const updated = buildWikiPlan(root, repository, { from: { ...old, pages: [selected] }, wikiDir: "guide" });
    expect(updated).toMatchObject({ formatVersion: 2, wikiDir: "guide", suggestions: { pages: expect.any(Array), sources: expect.any(Array) } });
    expect(updated.pages[0]).toMatchObject({ id: selected.id, title: "Maintainer title", documentIds: selected.documentIds, dependencySnapshot: { documents: expect.any(Array), sourceRefs: expect.any(Array) } });
    expect(validateWikiPlan(JSON.parse(JSON.stringify(updated)))).toEqual(updated);
  } finally {
    repository.close();
  }
});

it("rejects v2 parent cycles and unsafe wiki roots", async () => {
  const root = fixture();
  await indexProject(root, { full: true });
  const repository = new GraphRepository(openExistingDatabase(root));
  try {
    const plan = buildWikiPlan(root, repository);
    const pages = plan.pages.length > 1 ? [{ ...plan.pages[0], parentId: plan.pages[1].id }, { ...plan.pages[1], parentId: plan.pages[0].id }] : plan.pages;
    expect(() => validateWikiPlan({ ...plan, pages })).toThrow(/parent cycle/);
    expect(() => buildWikiPlan(root, repository, { wikiDir: "../wiki" })).toThrow(/project-relative/);
  } finally { repository.close(); }
});

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-wiki-plan-v2-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "README.md"), "# Sample\nquickstart\n");
  fs.writeFileSync(path.join(root, "docs", "Architecture.md"), "---\ntype: design\n---\n# Architecture\n");
  return root;
}

it("retains a deleted selected source path through refresh and JSON roundtrip", async () => {
  const root = fixture();
  await indexProject(root);
  let repository = new GraphRepository(openExistingDatabase(root));
  const old = buildWikiPlan(root, repository);
  repository.close();
  fs.renameSync(path.join(root, "docs/Architecture.md"), path.join(root, "docs/Architecture.txt"));
  await indexProject(root);
  repository = new GraphRepository(openExistingDatabase(root));
  try {
    const updated = buildWikiPlan(root, repository, { from: old });
    const reread = validateWikiPlan(JSON.parse(JSON.stringify(updated)));
    const page = reread.pages.find((page) => page.id === "architecture")!;
    expect(page.documentIds).toEqual(old.pages.find((page) => page.id === "architecture")!.documentIds);
    expect(page.dependencySnapshot?.documents).toContainEqual(expect.objectContaining({ path: "docs/Architecture.md", missing: true }));
    expect(page.gaps).toContainEqual(expect.objectContaining({ path: "docs/Architecture.md", kind: "document" }));
    expect(reread.gaps).toEqual(updated.gaps);
    expect(() => validateWikiPlan({ ...updated, pages: updated.pages.map((page) => ({ ...page, dependencySnapshot: undefined })) })).toThrow(/dependencySnapshot/);
  } finally { repository.close(); }
});

it("keeps new sources as suggestions and excludes Wiki output from project-neutral planning", async () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, "wiki"));
  fs.writeFileSync(path.join(root, "wiki/overview.md"), "# Wiki Architecture\nAuthored output.\n");
  await indexProject(root);
  let repository = new GraphRepository(openExistingDatabase(root));
  const old = buildWikiPlan(root, repository);
  const savedSourceHash = old.sourceHash;
  const ids = new Map(repository.allDocuments().map((doc) => [doc.id, doc.path]));
  expect(old.pages.flatMap((page) => page.documentIds).some((id) => ids.get(id)?.startsWith("wiki/"))).toBe(false);
  expect(old.pages.flatMap((page) => page.outline).join(" ")).not.toMatch(/Install and index|First useful query|Agent integration/);
  repository.close();
  fs.appendFileSync(path.join(root, "wiki/overview.md"), "Changed prose.\n");
  await indexProject(root);
  repository = new GraphRepository(openExistingDatabase(root));
  expect(buildWikiPlan(root, repository).sourceHash).toBe(savedSourceHash);
  repository.close();
  fs.writeFileSync(path.join(root, "docs/Architecture-Extension.md"), "---\ntype: design\n---\n# Orchard watering components\n");
  await indexProject(root);
  repository = new GraphRepository(openExistingDatabase(root));
  try {
    const updated = buildWikiPlan(root, repository, { from: old });
    expect(updated.pages.map((page) => page.documentIds)).toEqual(old.pages.map((page) => page.documentIds));
    expect(updated.suggestions?.sources.some((suggestion) => suggestion.documentIds.length > 0)).toBe(true);
    const partial = buildWikiPlan(root, repository, { from: { ...old, pages: old.pages.filter((page) => page.id !== "architecture") } });
    expect(partial.suggestions?.pages.find((page) => page.id === "architecture")).toMatchObject({ title: "Architecture", path: "architecture.md", outline: expect.any(Array), evidenceHash: expect.any(String) });
  } finally { repository.close(); }
});

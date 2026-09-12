import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load-config.js";
import { openExistingDatabase } from "../src/db/connection.js";
import { GraphRepository } from "../src/db/repositories.js";
import { indexProject } from "../src/indexer.js";
import { buildWikiPageBrief, buildWikiPlan, formatWikiPageBrief, sourceRefFingerprint, type WikiPlan } from "../src/wiki/wiki-plan.js";
import { buildWikiStatus, formatWikiStatus } from "../src/wiki/wiki-status.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const root of tempDirs.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Wiki evidence", () => {
  it("keeps an unreadable source reference as evidence instead of failing the brief", async () => {
    const root = createFixture();
    await indexProject(root, { full: true });
    const repository = new GraphRepository(openExistingDatabase(root));
    try {
      const originalOpen = fs.openSync;
      fs.openSync = ((filePath: fs.PathOrFileDescriptor, ...rest: Parameters<typeof fs.openSync>) => {
        if (path.normalize(String(filePath)).endsWith(path.join("src", "core.ts"))) throw new Error("simulated unreadable source");
        return originalOpen(filePath, ...rest);
      }) as typeof fs.openSync;
      try {
        expect(sourceRefFingerprint(root, "src/core.ts")).toBe("unreadable");
        expect(buildWikiPlan(root, repository).pages.find((page) => page.id === "architecture")?.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
      } finally {
        fs.openSync = originalOpen;
      }
    } finally {
      repository.close();
    }
  });

  it("keeps stale Markdown viewable, rejects its old brief hash, and reports the same recovery in text", async () => {
    const root = createFixture();
    const wikiDir = path.join(root, "wiki");
    await indexProject(root, { full: true });
    const repository = new GraphRepository(openExistingDatabase(root));
    try {
      const plan = buildWikiPlan(root, repository);
      writePlannedWiki(wikiDir, plan, repository);
      const architecturePath = path.join(root, "docs", "Architecture.md");
      const before = fs.statSync(architecturePath);
      fs.appendFileSync(architecturePath, "\nThis change retains mtime.\n", "utf8");
      fs.utimesSync(architecturePath, before.atime, before.mtime);

      const brief = buildWikiPageBrief(root, repository, loadConfig(root), plan, "architecture");
      const status = buildWikiStatus(root, repository, wikiDir, plan);
      expect(brief.strictFreshness.state).toBe("stale");
      expect(brief.writingRequirements).toEqual(expect.arrayContaining([
        expect.stringContaining("Do not set evidence_hash from this unresolved evidence.")
      ]));
      expect(status.pages.find((page) => page.id === "architecture")).toMatchObject({ state: "needs_update" });
      expect(formatWikiPageBrief(brief)).toContain("Source documents: docs/Architecture.md");
      expect(formatWikiPageBrief(brief)).toContain("Evidence freshness: stale");
      expect(formatWikiStatus(status)).toContain("Evidence freshness: stale");
      expect(formatWikiStatus(status)).toContain("Evidence recovery:");
    } finally {
      repository.close();
    }
  });

  it("isolates source-code and missing-document evidence from unrelated Markdown changes", async () => {
    const root = createFixture();
    const wikiDir = path.join(root, "wiki");
    await indexProject(root, { full: true });
    const repository = new GraphRepository(openExistingDatabase(root));
    try {
      const plan = buildWikiPlan(root, repository);
      writePlannedWiki(wikiDir, plan, repository);

      fs.appendFileSync(path.join(root, "src", "core.ts"), "export const changed = true;\n", "utf8");
      const sourceChanged = buildWikiStatus(root, repository, wikiDir, plan);
      expect(sourceChanged.pages.filter((page) => page.state === "needs_update").map((page) => page.id)).toEqual(["architecture"]);

      fs.renameSync(path.join(root, "docs", "Workflow.md"), path.join(root, "docs", "Workflow.missing"));
      const missing = buildWikiStatus(root, repository, wikiDir, plan);
      expect(missing.pages.filter((page) => page.state === "needs_update").map((page) => page.id).sort()).toEqual(["architecture", "core-workflows"]);

      const unrelatedRoot = createFixture();
      const unrelatedWikiDir = path.join(unrelatedRoot, "wiki");
      await indexProject(unrelatedRoot, { full: true });
      const unrelatedRepository = new GraphRepository(openExistingDatabase(unrelatedRoot));
      try {
        const unrelatedPlan = buildWikiPlan(unrelatedRoot, unrelatedRepository);
        writePlannedWiki(unrelatedWikiDir, unrelatedPlan, unrelatedRepository);
        fs.writeFileSync(path.join(unrelatedRoot, "docs", "Unrelated.md"), "# Unrelated\n", "utf8");
        const unrelated = buildWikiStatus(unrelatedRoot, unrelatedRepository, unrelatedWikiDir, unrelatedPlan);
        expect(unrelated.plan.indexFreshness).toMatchObject({ state: "stale", issues: expect.arrayContaining([expect.objectContaining({ path: "docs/Unrelated.md", reason: "added" })]) });
        expect(unrelated.pages.every((page) => page.state === "current")).toBe(true);
      } finally {
        unrelatedRepository.close();
      }
    } finally {
      repository.close();
    }
  });
});

function createFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-wiki-evidence-"));
  tempDirs.push(root);
  write(root, "README.md", "# Example\n\nProject overview and quickstart.\n");
  write(root, "docs/Architecture.md", "---\ntitle: Architecture\ntype: design\nsource_refs:\n  - src/core.ts\n---\n# Architecture\n");
  write(root, "docs/Workflow.md", "---\ntitle: Workflow\ntype: spec\nimplements:\n  - src/workflow.ts\n---\n# Workflow\n");
  write(root, "src/core.ts", "export const core = 1;\n");
  write(root, "src/workflow.ts", "export const workflow = 1;\n");
  return root;
}

function writePlannedWiki(wikiDir: string, plan: WikiPlan, repository: GraphRepository): void {
  fs.mkdirSync(wikiDir, { recursive: true });
  const documents = new Map(repository.allDocuments().map((document) => [document.id, document.path]));
  for (const page of plan.pages) {
    const sourceDocs = page.documentIds.flatMap((id) => documents.get(id) ? [documents.get(id)!] : []);
    fs.writeFileSync(path.join(wikiDir, page.path), [
      "---",
      `wiki_id: ${page.id}`,
      `evidence_hash: ${page.evidenceHash}`,
      yamlArray("source_docs", sourceDocs),
      yamlArray("source_refs", page.sourceRefs),
      "---",
      `# ${page.title}`,
      ""
    ].join("\n"), "utf8");
  }
}

function yamlArray(key: string, values: string[]): string {
  return values.length ? `${key}:\n${values.map((value) => `  - ${JSON.stringify(value)}`).join("\n")}` : `${key}: []`;
}

function write(root: string, relativePath: string, content: string): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

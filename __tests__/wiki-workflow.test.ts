import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load-config.js";
import { openExistingDatabase } from "../src/db/connection.js";
import { GraphRepository } from "../src/db/repositories.js";
import { indexProject } from "../src/indexer.js";
import {
  buildWikiPageBrief,
  buildWikiPlan,
  stableWikiPlan,
  validateWikiPlan,
  type WikiPlan,
  type WikiPlanPage
} from "../src/wiki/wiki-plan.js";
import { buildWikiStatus, verifyWiki } from "../src/wiki/wiki-status.js";

const repoRoot = path.resolve(__dirname, "..");
const cliPath = path.join(repoRoot, "dist", "bin", "mdgraph.js");
const tempDirs: string[] = [];

afterEach(() => {
  for (const root of tempDirs.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Wiki workflow", () => {
  it("creates byte-stable, evidence-backed plans without empty categories", async () => {
    const root = createWikiFixture();
    await indexProject(root, { full: true });
    const repository = new GraphRepository(openExistingDatabase(root));
    try {
      const first = buildWikiPlan(root, repository);
      const second = buildWikiPlan(root, repository);
      expect(stableWikiPlan(first)).toBe(stableWikiPlan(second));
      expect(first).toMatchObject({
        format: "mdgraph-wiki-plan",
        formatVersion: 2,
        graphHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        strictFreshness: { state: "fresh" }
      });
      expect(first.pages.map((page) => page.id)).toEqual([
        "project-overview",
        "architecture",
        "core-workflows",
        "development",
        "operations",
        "reference"
      ]);
      expect(first.pages.every((page) => page.documentIds.length > 0)).toBe(true);
      expect(first.pages.every((page) => page.path.endsWith(".md") && !page.path.includes(".."))).toBe(true);
      expect(first.pages.every((page) => /^[a-f0-9]{64}$/.test(page.evidenceHash))).toBe(true);

      const beforeHashes = new Map(first.pages.map((page) => [page.id, page.evidenceHash]));
      fs.appendFileSync(path.join(root, "src", "core.ts"), "export const architectureVersion = 2;\n", "utf8");
      const sourceChanged = buildWikiPlan(root, repository);
      const changedPages = sourceChanged.pages
        .filter((page) => page.evidenceHash !== beforeHashes.get(page.id))
        .map((page) => page.id);
      expect(changedPages).toEqual(["architecture"]);
      expect(sourceChanged.graphHash).toBe(first.graphHash);
      expect(sourceChanged.sourceHash).toBe(first.sourceHash);
    } finally {
      repository.close();
    }
  });

  it("builds a budgeted page brief from planned documents, source refs, context, and cards", async () => {
    const root = createWikiFixture();
    await indexProject(root, { full: true });
    const repository = new GraphRepository(openExistingDatabase(root));
    try {
      const plan = buildWikiPlan(root, repository);
      const brief = buildWikiPageBrief(root, repository, loadConfig(root), plan, "architecture", { maxChars: 16_000 });
      expect(brief).toMatchObject({
        format: "mdgraph-wiki-page-brief",
        formatVersion: 1,
        page: expect.objectContaining({ id: "architecture", path: "architecture.md" }),
        maxChars: 16_000,
        usedChars: expect.any(Number),
        sourceDocuments: expect.any(Array),
        contextItems: expect.any(Array),
        knowledgeCards: expect.any(Array),
        writingRequirements: expect.any(Array),
        suggestedNextQueries: expect.any(Array),
        strictFreshness: { state: "fresh" }
      });
      expect(brief.usedChars).toBeLessThanOrEqual(brief.maxChars);
      expect(brief.contextItems.some((item) => item.path === "docs/Architecture.md")).toBe(true);
      expect(brief.sourceDocuments).toEqual(expect.arrayContaining([expect.objectContaining({ path: "docs/Architecture.md", title: "System Architecture" })]));
      expect(brief.knowledgeCards.some((card) => card.kind === "document" && card.label === "System Architecture")).toBe(true);
      expect(brief.writingRequirements.some((requirement) => requirement.includes("evidence_hash"))).toBe(true);
      expect(() => buildWikiPageBrief(root, repository, loadConfig(root), plan, "missing-page")).toThrow(/not present in the plan/);
    } finally {
      repository.close();
    }
  });

  it("reports lifecycle states without overwriting user prose and verifies recovery boundaries", async () => {
    const root = createWikiFixture();
    const wikiDir = path.join(root, "wiki");
    await indexProject(root, { full: true });
    const repository = new GraphRepository(openExistingDatabase(root));
    try {
      const plan = buildWikiPlan(root, repository);
      const missing = buildWikiStatus(root, repository, wikiDir, plan);
      expect(missing.summary).toEqual({ current: 0, needs_update: 0, missing: plan.pages.length, orphaned: 0 });
      expect(missing.pages.every((page) => page.state === "missing" && page.recovery)).toBe(true);

      writePlannedWiki(wikiDir, plan, repository);
      const overviewPath = path.join(wikiDir, "index.md");
      fs.appendFileSync(overviewPath, "\nUser-maintained prose remains intact.\n", "utf8");
      const beforeStatus = fs.readFileSync(overviewPath, "utf8");
      const current = buildWikiStatus(root, repository, wikiDir, plan);
      const verification = verifyWiki(root, repository, wikiDir, plan);
      expect(current.summary).toEqual({ current: plan.pages.length, needs_update: 0, missing: 0, orphaned: 0 });
      expect(verification.valid).toBe(true);
      expect(fs.readFileSync(overviewPath, "utf8")).toBe(beforeStatus);

      fs.appendFileSync(path.join(root, "src", "core.ts"), "export const changed = true;\n", "utf8");
      const changed = buildWikiStatus(root, repository, wikiDir, plan);
      expect(changed.pages.filter((page) => page.state === "needs_update").map((page) => page.id)).toEqual(["architecture"]);
      expect(changed.pages.find((page) => page.id === "architecture")?.recovery).toContain("wiki plan");
      expect(changed.pages.filter((page) => page.id !== "architecture" && page.state === "current")).toHaveLength(plan.pages.length - 1);

      fs.writeFileSync(path.join(wikiDir, "legacy.md"), "---\nwiki_id: legacy-page\nevidence_hash: stale\nsource_docs: []\nsource_refs: []\n---\n# Legacy\n", "utf8");
      const orphaned = buildWikiStatus(root, repository, wikiDir, plan);
      expect(orphaned.pages).toEqual(expect.arrayContaining([expect.objectContaining({ id: "legacy-page", state: "orphaned", recovery: expect.any(String) })]));
      const invalid = verifyWiki(root, repository, wikiDir, plan);
      expect(invalid.valid).toBe(false);
      expect(invalid.errors.some((error) => error.code === "wiki.page_orphaned")).toBe(true);
    } finally {
      repository.close();
    }
  });

  it("rejects unsafe plans and surfaces unsafe source refs and unresolved links", async () => {
    const root = createWikiFixture();
    const wikiDir = path.join(root, "wiki");
    await indexProject(root, { full: true });
    const repository = new GraphRepository(openExistingDatabase(root));
    try {
      const plan = buildWikiPlan(root, repository);
      expect(() => validateWikiPlan({
        ...plan,
        pages: [{ ...plan.pages[0], path: "../escape.md" }]
      })).toThrow(/safe relative Markdown path/);
      expect(() => validateWikiPlan({
        ...plan,
        pages: [{ ...plan.pages[0], path: "nested/../escape.md" }]
      })).toThrow(/safe relative Markdown path/);
      expect(() => validateWikiPlan({
        ...plan,
        pages: [{ ...plan.pages[0], path: "C:/escape.md" }]
      })).toThrow(/safe relative Markdown path/);

      writePlannedWiki(wikiDir, plan, repository);
      const overview = plan.pages.find((page) => page.id === "project-overview")!;
      const overviewPath = path.join(wikiDir, overview.path);
      const raw = fs.readFileSync(overviewPath, "utf8")
        .replace("source_refs: []", "source_refs:\n  - ../outside.ts")
        .replace("# Project Overview", "# Project Overview\n\n[Missing](missing.md)");
      fs.writeFileSync(overviewPath, raw, "utf8");
      const verification = verifyWiki(root, repository, wikiDir, plan);
      expect(verification.valid).toBe(false);
      expect(verification.errors.some((error) => error.code === "wiki.source_ref_unsafe")).toBe(true);
      expect(verification.errors.some((error) => error.code === "wiki.link_unresolved")).toBe(true);
    } finally {
      repository.close();
    }
  });

  it("keeps Wiki evidence strict without spreading unrelated disk changes across pages", async () => {
    const root = createWikiFixture();
    const wikiDir = path.join(root, "wiki");
    await indexProject(root, { full: true });
    const repository = new GraphRepository(openExistingDatabase(root));
    try {
      const plan = buildWikiPlan(root, repository);
      writePlannedWiki(wikiDir, plan, repository);
      const architectureDocument = path.join(root, "docs", "Architecture.md");
      const originalStat = fs.statSync(architectureDocument);
      fs.appendFileSync(architectureDocument, "\nThis edit retains its old timestamp.\n", "utf8");
      fs.utimesSync(architectureDocument, originalStat.atime, originalStat.mtime);

      const changed = buildWikiStatus(root, repository, wikiDir, plan);
      expect(changed.plan.state).toBe("stale");
      expect(changed.plan.indexFreshness).toMatchObject({ state: "stale", issues: expect.arrayContaining([expect.objectContaining({ path: "docs/Architecture.md", reason: "modified" })]) });
      expect(changed.pages.filter((page) => page.state === "needs_update").map((page) => page.id)).toEqual(["architecture"]);
      expect(changed.pages.filter((page) => page.id !== "architecture" && page.state === "current")).toHaveLength(plan.pages.length - 1);
      expect(verifyWiki(root, repository, wikiDir, plan).errors.some((error) => error.code === "wiki.index_stale")).toBe(true);

      fs.writeFileSync(path.join(root, "docs", "New.md"), "# Newly added source document\n", "utf8");
      const added = buildWikiStatus(root, repository, wikiDir, plan);
      expect(added.plan.reason).toContain("Indexed Markdown evidence is stale");
      expect(added.pages.filter((page) => page.state === "needs_update").map((page) => page.id)).toEqual(["architecture"]);

      const architecture = plan.pages.find((page) => page.id === "architecture")!;
      const architectureWikiPath = path.join(wikiDir, architecture.path);
      const invalid = fs.readFileSync(architectureWikiPath, "utf8")
        .replace(/source_docs:\n(?:  - .*\n)+/, "source_docs: docs/Architecture.md\n")
        .replace(/source_refs:\n(?:  - .*\n)+/, "source_refs:\n  - src/core.ts\n  - 42\n");
      fs.writeFileSync(architectureWikiPath, invalid, "utf8");
      const malformed = verifyWiki(root, repository, wikiDir, plan);
      expect(malformed.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
        "wiki.source_docs_invalid",
        "wiki.source_refs_invalid"
      ]));

      const deletionRoot = createWikiFixture();
      const deletionWikiDir = path.join(deletionRoot, "wiki");
      await indexProject(deletionRoot, { full: true });
      const deletionRepository = new GraphRepository(openExistingDatabase(deletionRoot));
      try {
        const deletionPlan = buildWikiPlan(deletionRoot, deletionRepository);
        writePlannedWiki(deletionWikiDir, deletionPlan, deletionRepository);
        // Rename rather than delete so the test exercises an unindexed missing source
        // without making an irreversible filesystem change.
        fs.renameSync(path.join(deletionRoot, "docs", "Workflow.md"), path.join(deletionRoot, "docs", "Workflow.removed"));
        const deleted = buildWikiStatus(deletionRoot, deletionRepository, deletionWikiDir, deletionPlan);
        expect(deleted.plan.indexFreshness).toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ path: "docs/Workflow.md", reason: "deleted" })]) });
        expect(deleted.pages.find((page) => page.id === "core-workflows")).toMatchObject({ state: "needs_update" });
        expect(deleted.pages.filter((page) => page.id !== "core-workflows" && page.state === "current")).toHaveLength(deletionPlan.pages.length - 1);
      } finally {
        deletionRepository.close();
      }

      const overflowRoot = createWikiFixture();
      const overflowWikiDir = path.join(overflowRoot, "wiki");
      await indexProject(overflowRoot, { full: true });
      const overflowRepository = new GraphRepository(openExistingDatabase(overflowRoot));
      try {
        const overflowPlan = buildWikiPlan(overflowRoot, overflowRepository);
        writePlannedWiki(overflowWikiDir, overflowPlan, overflowRepository);
        for (let index = 0; index < 20; index += 1) {
          write(overflowRoot, `docs/added-${String(index).padStart(2, "0")}.md`, `# Added ${index}\n`);
        }
        fs.appendFileSync(path.join(overflowRoot, "README.md"), "\nChanged after twenty added documents.\n", "utf8");
        const overflow = buildWikiStatus(overflowRoot, overflowRepository, overflowWikiDir, overflowPlan);
        expect(overflow.plan.indexFreshness?.issues).toHaveLength(21);
        expect(overflow.plan.indexFreshness?.issues?.at(-1)).toMatchObject({ path: "README.md", reason: "modified" });
        expect(overflow.pages.find((page) => page.id === "project-overview")).toMatchObject({ state: "needs_update" });
      } finally {
        overflowRepository.close();
      }
    } finally {
      repository.close();
    }
  });

  it("exposes plan, brief, status, and verify through the CLI", async () => {
    const root = createWikiFixture();
    const wikiDir = path.join(root, "wiki");
    await indexProject(root, { full: true });
    const planResult = runCli(["wiki", "plan", "--out", "wiki-plan.json", "--json", "--path", root]);
    expect(planResult.status).toBe(0);
    const planOutput = JSON.parse(planResult.stdout) as { plan: WikiPlan };
    expect(planOutput.plan.pages.length).toBeGreaterThan(0);
    const briefResult = runCli(["wiki", "brief", "architecture", "--plan", "wiki-plan.json", "--json", "--path", root]);
    expect(briefResult.status).toBe(0);
    expect(JSON.parse(briefResult.stdout)).toMatchObject({ format: "mdgraph-wiki-page-brief", page: { id: "architecture" } });
    const missingVerify = runCli(["wiki", "verify", "wiki", "--plan", "wiki-plan.json", "--json", "--path", root]);
    expect(missingVerify.status).toBe(1);

    const repository = new GraphRepository(openExistingDatabase(root));
    try {
      writePlannedWiki(wikiDir, planOutput.plan, repository);
    } finally {
      repository.close();
    }
    const statusResult = runCli(["wiki", "status", "wiki", "--plan", "wiki-plan.json", "--json", "--path", root]);
    const verifyResult = runCli(["wiki", "verify", "wiki", "--plan", "wiki-plan.json", "--json", "--path", root]);
    expect(statusResult.status).toBe(0);
    expect(JSON.parse(statusResult.stdout).summary.current).toBe(planOutput.plan.pages.length);
    expect(verifyResult.status).toBe(0);
    expect(JSON.parse(verifyResult.stdout)).toMatchObject({ valid: true, errors: [] });
  });
});

function createWikiFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-wiki-workflow-"));
  tempDirs.push(root);
  write(root, "README.md", "# Example Project\n\nA local-first project overview with installation and quickstart guidance.\n");
  write(root, "docs/Architecture.md", [
    "---",
    "title: System Architecture",
    "type: design",
    "source_refs:",
    "  - src/core.ts",
    "---",
    "# Architecture",
    "",
    "The module boundary and data flow are implemented by `src/core.ts`.",
    ""
  ].join("\n"));
  write(root, "docs/Workflow.md", [
    "---",
    "title: Retrieval Workflow",
    "type: spec",
    "implements:",
    "  - src/workflow.ts",
    "---",
    "# Retrieval Workflow",
    "",
    "Indexing, search, context, node, and trace form the core workflow.",
    ""
  ].join("\n"));
  write(root, "CONTRIBUTING.md", "# Contributing\n\nDevelopment setup, build, testing, and contribution checks.\n");
  write(root, "docs/Runbook.md", [
    "---",
    "title: Operations Runbook",
    "type: runbook",
    "source_refs:",
    "  - scripts/recover.sh",
    "---",
    "# Operations Runbook",
    "",
    "Use doctor and recovery diagnostics when watch mode fails.",
    ""
  ].join("\n"));
  write(root, "docs/CLI_Reference.md", [
    "---",
    "title: CLI and MCP Reference",
    "type: api",
    "implements:",
    "  - src/cli.ts",
    "---",
    "# CLI Reference",
    "",
    "Public command, MCP, configuration, and output contracts.",
    ""
  ].join("\n"));
  write(root, "src/core.ts", "export const architectureVersion = 1;\n");
  write(root, "src/workflow.ts", "export const workflow = true;\n");
  write(root, "src/cli.ts", "export const cli = true;\n");
  write(root, "scripts/recover.sh", "#!/bin/sh\nexit 0\n");
  return root;
}

function writePlannedWiki(wikiDir: string, plan: WikiPlan, repository: GraphRepository): void {
  fs.mkdirSync(wikiDir, { recursive: true });
  const documents = new Map(repository.allDocuments().map((document) => [document.id, document.path]));
  for (const page of plan.pages) {
    const sourceDocs = page.documentIds.flatMap((id) => documents.get(id) ? [documents.get(id)!] : []);
    const links = page.id === "project-overview" ? "\n[Architecture](architecture.md#architecture)\n" : "";
    fs.writeFileSync(path.join(wikiDir, page.path), [
      "---",
      `wiki_id: ${page.id}`,
      `evidence_hash: ${page.evidenceHash}`,
      yamlArray("source_docs", sourceDocs),
      yamlArray("source_refs", page.sourceRefs),
      "---",
      `# ${page.title}`,
      links,
      `Maintained content for ${page.purpose}`,
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

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

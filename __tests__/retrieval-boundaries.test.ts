import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config/load-config.js";
import { openDatabase } from "../src/db/connection.js";
import { GraphRepository } from "../src/db/repositories.js";
import { indexProject } from "../src/indexer.js";
import { buildContext } from "../src/query/context-builder.js";
import { buildKnowledgeCard } from "../src/query/knowledge-card.js";
import { searchGraph } from "../src/query/search.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const root of tempDirs.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("retrieval boundaries", () => {
  it("matches lowercase and Chinese frontmatter-only definitions through their definition edges", async () => {
    const root = createBoundaryProject();
    await indexProject(root, { full: true });
    const repository = new GraphRepository(openDatabase(root));
    try {
      for (const query of ["config", "配置项"]) {
        const result = searchGraph(repository, DEFAULT_CONFIG, query, 5).find((item) => item.document.path === "docs/frontmatter-only.md");
        expect(result?.reason).toContain("definition matched an explicit query entity");
        expect(result?.matchedEntities.map((entity) => entity.name)).toContain(query);
      }
    } finally {
      repository.close();
    }
  });

  it("keeps card JSON within the default 4000-character budget for long Unicode labels and rejects impossible budgets", async () => {
    const root = createBoundaryProject();
    await indexProject(root, { full: true });
    const repository = new GraphRepository(openDatabase(root));
    try {
      const document = repository.resolveNode("docs/long-title.md");
      const card = buildKnowledgeCard(repository, document!);
      expect(JSON.stringify(card).length).toBeLessThanOrEqual(4_000);
      expect(card).toMatchObject({ nodeId: document?.id, kind: "document" });
      expect(card?.label.endsWith("\ud83e")).toBe(false);
      expect(() => buildKnowledgeCard(repository, document!, { maxChars: 1 })).toThrow(/minimum representable card size/u);
    } finally {
      repository.close();
    }
  });

  it("does not displace packed Markdown content when the remaining context budget cannot hold a card summary", async () => {
    const root = createBoundaryProject();
    await indexProject(root, { full: true });
    const repository = new GraphRepository(openDatabase(root));
    try {
      const context = buildContext(repository, DEFAULT_CONFIG, "config", { maxChars: 80 });
      expect(context.items.length).toBeGreaterThan(0);
      expect(context.items.every((item) => item.cardSummary === undefined)).toBe(true);
      expect(context.usedChars).toBe(context.items.reduce((total, item) => total + item.content.length, 0));
    } finally {
      repository.close();
    }
  });
});

function createBoundaryProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-retrieval-boundaries-"));
  tempDirs.push(root);
  const docs = path.join(root, "docs");
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, "frontmatter-only.md"), [
    "---",
    "title: Frontmatter Definitions",
    "defines:",
    "  - config",
    "  - 配置项",
    "---",
    "# A neutral heading",
    "",
    "This body intentionally does not repeat either declared name.",
    ""
  ].join("\n"), "utf8");
  const title = "🧪".repeat(2_500);
  fs.writeFileSync(path.join(docs, "long-title.md"), [
    "---",
    `title: ${title}`,
    "defines:",
    "  - LongTitleEntity",
    "---",
    "# Compact body",
    "",
    "The body remains short.",
    ""
  ].join("\n"), "utf8");
  return root;
}

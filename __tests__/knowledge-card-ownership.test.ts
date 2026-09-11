import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { GraphRepository } from "../src/db/repositories.js";
import { indexProject } from "../src/indexer.js";
import { buildKnowledgeCard } from "../src/query/knowledge-card.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("KnowledgeCard ownership", () => {
  it("keeps section facts direct and document frontmatter background inherited", async () => {
    const root = createOwnershipProject();
    await indexProject(root, { full: true });
    const repository = new GraphRepository(openDatabase(root));
    try {
      const document = repository.resolveNode("docs/ownership.md");
      const first = repository.resolveNode("docs/ownership.md#defines");
      const second = repository.allSections().filter((section) => section.documentId === document?.id && section.heading === "Defines")[1];
      const documentCard = buildKnowledgeCard(repository, document!, { maxChars: 50_000 });
      const firstCard = buildKnowledgeCard(repository, first!, { maxChars: 50_000 });

      expect(firstCard?.definitions).toEqual(expect.arrayContaining([
        expect.objectContaining({ label: "FirstTerm", association: "direct", originNodeId: first?.id })
      ]));
      expect(firstCard?.sourceRefs).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "src/ownership.ts", association: "inherited", originNodeId: document?.id })
      ]));
      expect(firstCard?.summary).toContain("document-frontmatter facts are marked inherited");
      expect(documentCard?.definitions).toEqual(expect.arrayContaining([
        expect.objectContaining({ label: "FirstTerm", association: "inherited", originNodeId: first?.id }),
        expect.objectContaining({ label: "SecondTerm", association: "inherited", originNodeId: second?.id })
      ]));
      expect(documentCard?.definitions.filter((item) => item.label === "FirstTerm")).toHaveLength(1);
    } finally {
      repository.close();
    }
  });

  it("marks entity source references as related graph background rather than direct implementation", async () => {
    const root = createOwnershipProject();
    await indexProject(root, { full: true });
    const repository = new GraphRepository(openDatabase(root));
    try {
      const entity = repository.resolveNode("DeclaredTerm");
      const card = buildKnowledgeCard(repository, entity!);
      const source = card?.sourceRefs.find((item) => item.path === "src/ownership.ts");
      expect(source).toMatchObject({ association: "related", originNodeId: expect.any(String), viaNodeId: expect.any(String) });
      expect(card?.nextReads).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "src/ownership.ts", association: "related", reason: expect.stringContaining("not direct implementation proof") })
      ]));
    } finally {
      repository.close();
    }
  });

  it("keeps each entity source reference attached to its actual graph document path", async () => {
    const root = createTwoDefinitionDocuments();
    await indexProject(root, { full: true });
    const repository = new GraphRepository(openDatabase(root));
    try {
      const entity = repository.resolveNode("SharedTerm");
      const firstDocument = repository.resolveNode("docs/first.md");
      const secondDocument = repository.resolveNode("docs/second.md");
      const card = buildKnowledgeCard(repository, entity!, { maxChars: 50_000 });
      expect(card?.sourceRefs).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "src/first.ts", association: "related", originNodeId: firstDocument?.id, viaNodeId: firstDocument?.id }),
        expect.objectContaining({ path: "src/second.ts", association: "related", originNodeId: secondDocument?.id, viaNodeId: secondDocument?.id })
      ]));
      expect(card?.nextReads?.every((item) => Boolean(item.path) && item.nodeId !== entity?.id)).toBe(true);
    } finally {
      repository.close();
    }
  });

  it("deduplicates only identical ownership and reports bounded next reads in the JSON budget", async () => {
    const root = createOwnershipProject(24);
    await indexProject(root, { full: true });
    const repository = new GraphRepository(openDatabase(root));
    try {
      const document = repository.resolveNode("docs/ownership.md");
      const card = buildKnowledgeCard(repository, document!, { maxNextReads: 2, maxChars: 4_000 });
      expect(card?.nextReads?.length).toBeGreaterThan(0);
      expect(card?.nextReads?.length).toBeLessThanOrEqual(2);
      expect(JSON.stringify(buildKnowledgeCard(repository, document!, { maxNextReads: 2, maxChars: 4_000 }))).toBe(JSON.stringify(card));
      expect(JSON.stringify(card).length).toBeLessThanOrEqual(4_000);
      expect(card?.evidence.slice(0, 2).every((item) => item.association === "direct" || item.association === "inherited")).toBe(true);
    } finally {
      repository.close();
    }
  });
});

function createOwnershipProject(extraSections = 0): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-knowledge-card-ownership-"));
  roots.push(root);
  const docs = path.join(root, "docs");
  fs.mkdirSync(docs, { recursive: true });
  const sections = Array.from({ length: extraSections }, (_, index) => [
    `## Defines ${index}`,
    "",
    `- \`ExtraTerm${index}\`: extra ownership evidence.`,
    ""
  ].join("\n"));
  fs.writeFileSync(path.join(docs, "ownership.md"), [
    "---",
    "title: Ownership",
    "defines:",
    "  - DeclaredTerm",
    "implements:",
    "  - src/ownership.ts",
    "---",
    "# Ownership",
    "",
    "## Defines",
    "",
    "- `FirstTerm`: section-local definition.",
    "",
    "## Defines",
    "",
    "- `SecondTerm`: another section-local definition.",
    "",
    ...sections
  ].join("\n"), "utf8");
  return root;
}

function createTwoDefinitionDocuments(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-knowledge-card-source-ownership-"));
  roots.push(root);
  const docs = path.join(root, "docs");
  fs.mkdirSync(docs, { recursive: true });
  for (const [name, source] of [["first", "src/first.ts"], ["second", "src/second.ts"]] as const) {
    fs.writeFileSync(path.join(docs, `${name}.md`), [
      "---",
      `title: ${name}`,
      "defines:",
      "  - SharedTerm",
      "implements:",
      `  - ${source}`,
      "---",
      `# ${name}`,
      ""
    ].join("\n"), "utf8");
  }
  return root;
}

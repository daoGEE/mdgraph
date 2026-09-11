import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config/load-config.js";
import { openDatabase } from "../src/db/connection.js";
import { GraphRepository } from "../src/db/repositories.js";
import { indexProject } from "../src/indexer.js";
import { buildContext } from "../src/query/context-builder.js";
import {
  buildKnowledgeCard,
  createKnowledgeCardBuilder
} from "../src/query/knowledge-card.js";
import { createAlphaFixtureDocs } from "./fixtures.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const root of tempDirs.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("KnowledgeCard", () => {
  it("builds deterministic cards for every supported structural node kind", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-knowledge-card-"));
    tempDirs.push(root);
    createAlphaFixtureDocs(root);
    await indexProject(root, { full: true });

    const repository = new GraphRepository(openDatabase(root));
    try {
      const countsBefore = repository.counts();
      const document = repository.resolveNode("docs/auth-v2-design.md");
      const section = repository.resolveNode("docs/auth-v2-design.md#session-refresh");
      const entity = repository.resolveNode("AuthService");
      const sourceRef = repository.resolveNode("src/auth/AuthService.ts");
      expect(document?.kind).toBe("document");
      expect(section?.kind).toBe("section");
      expect(entity?.kind).toBe("entity");
      expect(sourceRef?.kind).toBe("source_ref");

      const builder = createKnowledgeCardBuilder(repository);
      const documentCard = builder.build(document!);
      const sectionCard = builder.build(section!);
      const entityCard = builder.build(entity!);
      const sourceRefCard = builder.build(sourceRef!);

      expect(documentCard).toMatchObject({
        kind: "document",
        label: "Auth v2 Design",
        definitions: expect.arrayContaining([expect.objectContaining({ label: "AuthService", edgeKind: "DEFINES" })]),
        sourceRefs: expect.arrayContaining([expect.objectContaining({ path: "src/auth/AuthService.ts", edgeKind: "IMPLEMENTS", provenance: "frontmatter" })])
      });
      expect(documentCard?.relatedDocuments.map((reference) => reference.path)).toEqual(expect.arrayContaining([
        "docs/adr/adr-001-cache-failure-policy.md",
        "docs/auth-v3-design.md",
        "docs/redis-cache-design.md"
      ]));
      expect(sectionCard).toMatchObject({
        kind: "section",
        summary: expect.stringContaining("#session-refresh"),
        relatedDocuments: expect.arrayContaining([expect.objectContaining({ path: "docs/auth-v2-design.md" })])
      });
      expect(entityCard).toMatchObject({
        kind: "entity",
        definitions: expect.arrayContaining([expect.objectContaining({ path: "docs/auth-v2-design.md", edgeKind: "DEFINES" })]),
        relatedDocuments: expect.arrayContaining([expect.objectContaining({ path: "docs/auth-v2-design.md" })]),
        sourceRefs: expect.arrayContaining([expect.objectContaining({ path: "src/auth/AuthService.ts" })])
      });
      expect(sourceRefCard).toMatchObject({
        kind: "source_ref",
        relatedDocuments: expect.arrayContaining([expect.objectContaining({ path: "docs/auth-v2-design.md" })]),
        evidence: expect.arrayContaining([expect.objectContaining({ edgeKind: "IMPLEMENTS", provenance: "frontmatter" })])
      });

      expect(JSON.stringify(builder.build(entity!))).toBe(JSON.stringify(entityCard));
      expect(repository.counts()).toEqual(countsBefore);
    } finally {
      repository.close();
    }
  });

  it("applies stable count and character budgets with explicit omission counts", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-knowledge-card-budget-"));
    tempDirs.push(root);
    createAlphaFixtureDocs(root);
    await indexProject(root, { full: true });

    const repository = new GraphRepository(openDatabase(root));
    try {
      const document = repository.resolveNode("docs/auth-v2-design.md");
      const card = buildKnowledgeCard(repository, document!, {
        maxDefinitions: 0,
        maxSourceRefs: 0,
        maxRelatedDocuments: 1,
        maxEvidence: 1
      });
      expect(card?.definitions).toEqual([]);
      expect(card?.sourceRefs).toEqual([]);
      expect(card?.relatedDocuments).toHaveLength(1);
      expect(card?.evidence).toHaveLength(1);
      expect(card?.truncated).toMatchObject({
        definitions: expect.any(Number),
        sourceRefs: expect.any(Number),
        relatedDocuments: expect.any(Number),
        evidence: expect.any(Number)
      });
      expect(JSON.stringify(buildKnowledgeCard(repository, document!)).length).toBeLessThanOrEqual(4_000);
    } finally {
      repository.close();
    }
  });

  it("counts required truncation metadata and text omission markers in the JSON budget", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-knowledge-card-minimum-"));
    tempDirs.push(root);
    createAlphaFixtureDocs(root);
    await indexProject(root, { full: true });

    const repository = new GraphRepository(openDatabase(root));
    try {
      const document = repository.resolveNode("docs/auth-v2-design.md");
      const countLimited = buildKnowledgeCard(repository, document!, {
        maxDefinitions: 0,
        maxSourceRefs: 0,
        maxRelatedDocuments: 0,
        maxEvidence: 0,
        maxChars: 50_000
      });
      expect(countLimited?.truncated).toBeDefined();
      const structuralMinimumBudget = JSON.stringify({
        ...countLimited,
        label: "",
        summary: "",
        definitions: [],
        sourceRefs: [],
        relatedDocuments: [],
        evidence: []
      }).length;
      expect(() => buildKnowledgeCard(repository, document!, {
        maxDefinitions: 0,
        maxSourceRefs: 0,
        maxRelatedDocuments: 0,
        maxEvidence: 0,
        maxChars: structuralMinimumBudget - 1
      })).toThrow(/truncation metadata/u);
      const markerMinimumBudget = JSON.stringify({
        ...countLimited,
        label: "…",
        summary: "…",
        definitions: [],
        sourceRefs: [],
        relatedDocuments: [],
        evidence: []
      }).length;
      const atMinimum = buildKnowledgeCard(repository, document!, {
        maxDefinitions: 0,
        maxSourceRefs: 0,
        maxRelatedDocuments: 0,
        maxEvidence: 0,
        maxChars: markerMinimumBudget
      });
      expect(JSON.stringify(atMinimum).length).toBeLessThanOrEqual(markerMinimumBudget);
      expect(atMinimum?.nodeId).toBe(document?.id);
      expect(atMinimum?.truncated).toEqual(countLimited?.truncated);
      expect(() => buildKnowledgeCard(repository, document!, {
        maxDefinitions: 0,
        maxSourceRefs: 0,
        maxRelatedDocuments: 0,
        maxEvidence: 0,
        maxChars: markerMinimumBudget - 1
      })).toThrow(/truncated text markers/u);

      const textLimited = buildKnowledgeCard(repository, document!, {
        maxDefinitions: 0,
        maxSourceRefs: 0,
        maxRelatedDocuments: 0,
        maxEvidence: 0,
        maxChars: markerMinimumBudget + 8
      });
      expect(textLimited?.summary.endsWith("…") || textLimited?.label.endsWith("…")).toBe(true);
      expect(JSON.stringify(textLimited).length).toBeLessThanOrEqual(markerMinimumBudget + 8);
    } finally {
      repository.close();
    }
  });

  it("adds card summaries only from spare context budget and counts their characters", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-context-card-"));
    tempDirs.push(root);
    createAlphaFixtureDocs(root);
    await indexProject(root, { full: true });

    const repository = new GraphRepository(openDatabase(root));
    try {
      const context = buildContext(repository, DEFAULT_CONFIG, "AuthService RedisTimeoutError", {
        maxChars: 50_000
      });
      expect(context.items.some((item) => item.cardSummary)).toBe(true);
      expect(context.usedChars).toBe(context.items.reduce(
        (sum, item) => sum + item.content.length + (item.cardSummary?.length ?? 0),
        0
      ));
      expect(context.usedChars).toBeLessThanOrEqual(context.maxChars);

      const rawOnly = buildContext(repository, DEFAULT_CONFIG, "AuthService RedisTimeoutError", {
        maxChars: 80
      });
      expect(rawOnly.items.every((item) => item.cardSummary === undefined)).toBe(true);
      expect(rawOnly.usedChars).toBe(rawOnly.items.reduce((sum, item) => sum + item.content.length, 0));
    } finally {
      repository.close();
    }
  });
});

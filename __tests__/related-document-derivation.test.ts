import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load-config.js";
import { openDatabase } from "../src/db/connection.js";
import { GraphRepository } from "../src/db/repositories.js";
import { buildGraphRecords } from "../src/extraction/graph-builder.js";
import { parseMarkdownDocument } from "../src/parser/markdown-parser.js";
import { parseStructuredQuery } from "../src/query/structured-query.js";
import { traceNodes } from "../src/query/trace.js";
import {
  deriveRelatedRelationships
} from "../src/relationships/derive-related.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("provider-gated RELATED_TO derivation", () => {
  it("supports dry-run, atomically applies symmetric edges, and refuses stale indexes", async () => {
    const root = relationshipFixture("ollama");
    const repository = new GraphRepository(openDatabase(root));
    try {
      const config = loadConfig(root);
      const dryRun = await deriveRelatedRelationships(repository, root, config, { threshold: 0.9, dryRun: true });
      expect(dryRun.relationshipPairs).toBe(1);
      expect(dryRun.directedEdges).toBe(2);
      expect(dryRun.mutation).toEqual({ dryRun: true, removed: 0, inserted: 0 });
      expect(relatedEdges(repository)).toEqual([]);

      const applied = await deriveRelatedRelationships(repository, root, config, { threshold: 0.9 });
      expect(applied.qualityGate.passed).toBe(true);
      expect(applied.mutation).toEqual({ dryRun: false, removed: 0, inserted: 2 });
      expect(relatedEdges(repository)).toHaveLength(2);
      expect(relatedEdges(repository).every((edge) => (
        edge.confidence === 1
        && edge.weight === 2
        && edge.metadata?.provider === "ollama"
        && edge.metadata?.symmetric === true
        && Array.isArray(edge.metadata?.evidenceSections)
      ))).toBe(true);
      expect(repository.documentLinkStats().every((item) => item.nonContainmentEdges === 0)).toBe(true);
      const firstToSecond = repository.queryStructuredDocuments(parseStructuredQuery(
        "path ~ first.md AND edge.RELATED_TO ~ second.md"
      ));
      const secondToFirst = repository.queryStructuredDocuments(parseStructuredQuery(
        "path ~ second.md AND edge.RELATED_TO ~ first.md"
      ));
      expect(firstToSecond.documents.map((document) => document.path)).toEqual(["docs/first.md"]);
      expect(secondToFirst.documents.map((document) => document.path)).toEqual(["docs/second.md"]);
      const documents = repository.allDocuments();
      const trace = traceNodes(repository, documents[0].id, documents[1].id);
      expect(trace.steps[0]).toMatchObject({ edgeKind: "RELATED_TO", provenance: "embedding_similarity" });

      fs.appendFileSync(path.join(root, "docs", "first.md"), "\nChanged after indexing.\n", "utf8");
      await expect(deriveRelatedRelationships(repository, root, config, { threshold: 0.9 })).rejects.toMatchObject({ code: "stale_index" });
      expect(relatedEdges(repository)).toHaveLength(2);

      const changed = parseMarkdownDocument(root, path.join(root, "docs", "first.md"));
      const changedRecords = buildGraphRecords([changed], config);
      changedRecords.vectors = changedRecords.chunks.map((chunk) => ({
        chunkId: chunk.id,
        provider: config.embedding.provider,
        model: config.embedding.model,
        dimensions: config.embedding.dimensions,
        vector: [1, 0, 0, 0],
        createdAt: new Date().toISOString()
      }));
      repository.replaceDocuments(changedRecords, [changed.id], []);
      expect(relatedEdges(repository)).toEqual([]);
    } finally {
      repository.close();
    }
  });

  it("rejects lexical-hash providers, incomplete vector coverage, and unsafe thresholds without mutation", async () => {
    const lexicalRoot = relationshipFixture("local-hash");
    const lexicalRepository = new GraphRepository(openDatabase(lexicalRoot));
    try {
      await expect(deriveRelatedRelationships(lexicalRepository, lexicalRoot, loadConfig(lexicalRoot))).rejects.toMatchObject({ code: "provider_not_semantic" });
      expect(relatedEdges(lexicalRepository)).toEqual([]);
    } finally {
      lexicalRepository.close();
    }

    const incompleteRoot = relationshipFixture("ollama");
    const database = openDatabase(incompleteRoot);
    database.prepare("DELETE FROM chunk_vectors WHERE chunk_id = (SELECT chunk_id FROM chunk_vectors ORDER BY chunk_id LIMIT 1)").run();
    database.close();
    const incompleteRepository = new GraphRepository(openDatabase(incompleteRoot));
    try {
      await expect(deriveRelatedRelationships(incompleteRepository, incompleteRoot, loadConfig(incompleteRoot))).rejects.toMatchObject({ code: "incomplete_vector_coverage" });
      await expect(deriveRelatedRelationships(incompleteRepository, incompleteRoot, loadConfig(incompleteRoot), { threshold: 0.5 })).rejects.toMatchObject({ code: "invalid_options" });
      expect(relatedEdges(incompleteRepository)).toEqual([]);
    } finally {
      incompleteRepository.close();
    }
  });

  it("exposes the experimental CLI command without contacting the configured provider", () => {
    const root = relationshipFixture("ollama");
    const result = spawnSync(process.execPath, [
      "dist/bin/mdgraph.js",
      "relationships",
      "derive",
      "--threshold",
      "0.9",
      "--json",
      "--path",
      root
    ], { cwd: path.resolve("."), encoding: "utf8" });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      provider: "ollama",
      qualityGate: { passed: true },
      relationshipPairs: 1,
      directedEdges: 2,
      mutation: { inserted: 2 }
    });
    const repository = new GraphRepository(openDatabase(root));
    try {
      expect(relatedEdges(repository)).toHaveLength(2);
    } finally {
      repository.close();
    }
  });
});

function relationshipFixture(provider: "ollama" | "local-hash"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-related-surface-"));
  tempDirs.push(root);
  fs.mkdirSync(path.join(root, ".mdgraph"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, ".mdgraph", "config.json"), `${JSON.stringify({
    docs: { include: ["docs/**/*.md"] },
    embedding: {
      enabled: true,
      provider,
      model: provider === "ollama" ? "fixture-model" : "mdgraph-local-hash-v1",
      dimensions: 4
    }
  }, null, 2)}\n`, "utf8");
  writeDocument(root, "first.md", "First");
  writeDocument(root, "second.md", "Second");
  const config = loadConfig(root);
  const parsed = ["first.md", "second.md"].map((file) => parseMarkdownDocument(root, path.join(root, "docs", file)));
  const records = buildGraphRecords(parsed, config);
  const createdAt = new Date().toISOString();
  records.vectors = records.chunks.map((chunk) => ({
    chunkId: chunk.id,
    provider: config.embedding.provider,
    model: config.embedding.model,
    dimensions: config.embedding.dimensions,
    vector: [1, 0, 0, 0],
    createdAt
  }));
  const repository = new GraphRepository(openDatabase(root));
  try {
    repository.replaceAll(records);
  } finally {
    repository.close();
  }
  return root;
}

function writeDocument(root: string, file: string, title: string): void {
  fs.writeFileSync(path.join(root, "docs", file), `---
title: ${title}
type: guide
status: active
---
## Evidence A

Semantic evidence A.

## Evidence B

Semantic evidence B.
`, "utf8");
}

function relatedEdges(repository: GraphRepository) {
  return repository.allEdges().filter((edge) => edge.kind === "RELATED_TO");
}

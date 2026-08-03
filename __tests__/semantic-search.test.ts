import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load-config.js";
import { openDatabase } from "../src/db/connection.js";
import { GraphRepository } from "../src/db/repositories.js";
import { evaluateRetrieval } from "../src/evaluation/retrieval-eval.js";
import { indexProject } from "../src/indexer.js";
import { searchGraph } from "../src/query/search.js";
import { semanticStatusReport } from "../src/semantic/status.js";
import { decodeFloat32Vector } from "../src/semantic/vector-codec.js";
import { createFixtureDocs } from "./fixtures.js";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("semantic search", () => {
  it("indexes compact local vectors and can include semantic metadata", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-semantic-"));
    tempDirs.push(root);
    createFixtureDocs(root);

    const result = await indexProject(root, { semantic: true });
    expect(result.counts.vectors).toBeGreaterThan(0);

    const repository = new GraphRepository(openDatabase(root));
    try {
      const config = loadConfig(root);
      const results = searchGraph(repository, config, "session refresh RedisTimeoutError", 5, { semantic: true });
      const semanticResult = results.find((item) => item.reason.includes("semantic"));
      expect(semanticResult?.semantic).toMatchObject({
        source: "chunk_vector",
        provider: "local-hash",
        model: "mdgraph-local-hash-v1"
      });
      expect(semanticResult?.semantic?.confidence).toBeGreaterThan(0);

      const db = openDatabase(root);
      try {
        const columns = (db.prepare("PRAGMA table_info(chunk_vectors)").all() as Array<{ name: string }>).map((column) => column.name);
        expect(columns).toContain("vector_blob");
        expect(columns).not.toContain("vector_json");

        const row = db.prepare("SELECT dimensions, vector_blob FROM chunk_vectors LIMIT 1").get() as { dimensions: number; vector_blob: unknown };
        expect(decodeFloat32Vector(row.vector_blob)).toHaveLength(row.dimensions);
      } finally {
        db.close();
      }

      const enabledConfig = { ...config, embedding: { ...config.embedding, enabled: true } };
      const status = semanticStatusReport(enabledConfig, repository.counts(), repository.storageDiagnostics());
      expect(status.state).toBe("ready");
      expect(status.vectorStorageFormat).toBe("float32_blob");
      expect(status.providerSupported).toBe(true);

      const semanticEval = evaluateRetrieval(repository, enabledConfig, {
        queryMode: "semantic",
        limit: 5,
        cases: [{
          id: "semantic-ranking-1",
          query: "session refresh RedisTimeoutError",
          expectedDocuments: ["docs/auth-v2-design.md", "docs/redis-cache-design.md"],
          expectedSections: [],
          expectedEntities: [],
          expectedEdges: [],
          expectedSourceRefs: []
        }]
      });
      expect(semanticEval.ranking.queryMode).toBe("semantic");
      expect(semanticEval.ranking.searchFusion).toBe("rrf");
      expect(semanticEval.ranking.searchChannels).toContain("semantic");
      expect(semanticEval.ranking.optionalReranker).toBe("local-hash");
      expect(semanticEval.ranking.semanticActiveCases).toBe(1);
    } finally {
      repository.close();
    }
  });

  it("degrades unsupported semantic providers to non-semantic search", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-semantic-unsupported-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    await indexProject(root);

    const repository = new GraphRepository(openDatabase(root));
    try {
      const config = {
        ...loadConfig(root),
        embedding: {
          enabled: true,
          provider: "missing-provider",
          model: "missing-model",
          dimensions: 768
        }
      };
      const status = semanticStatusReport(config, repository.counts(), repository.storageDiagnostics());
      expect(status.state).toBe("unsupported_provider");
      expect(status.guidance.join(" ")).toContain("degrades to FTS5 and graph search");

      const results = searchGraph(repository, config, "RedisTimeoutError", 5, { semantic: true });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((result) => result.semantic === undefined)).toBe(true);
    } finally {
      repository.close();
    }
  });
});

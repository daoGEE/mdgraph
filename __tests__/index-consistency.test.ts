import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { GraphRepository } from "../src/db/repositories.js";
import { indexProject } from "../src/indexer.js";
import { registerEmbeddingProvider } from "../src/semantic/provider-registry.js";
import { createFixtureDocs } from "./fixtures.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-index-consistency-"));
  roots.push(root);
  createFixtureDocs(root);
  return root;
}

describe("index consistency", () => {
  it("treats extraction settings as rebuild inputs but ignores query-only settings", async () => {
    const root = fixtureRoot();
    fs.writeFileSync(path.join(root, "docs", "stop-entity.md"), "# Stop Entity\n\n`TransientWatcherEntity` is only an inline reference.\n", "utf8");
    await indexProject(root);
    const configPath = path.join(root, ".mdgraph", "config.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ search: { defaultLimit: 3 } }), "utf8");
    expect((await indexProject(root)).mode).toBe("incremental");

    fs.writeFileSync(configPath, JSON.stringify({ entities: { stopEntities: ["TransientWatcherEntity"] } }), "utf8");
    expect((await indexProject(root)).mode).toBe("full");
    const repository = new GraphRepository(openDatabase(root));
    try {
      expect(repository.allEntities().some((entity) => entity.name === "TransientWatcherEntity")).toBe(false);
    } finally {
      repository.close();
    }
  });

  it("reuses vectors for unchanged chunks across an explicit full rebuild", async () => {
    const root = fixtureRoot();
    await indexProject(root, { semantic: true });
    const db = openDatabase(root);
    const before = db.prepare("SELECT chunk_id, created_at FROM chunk_vectors ORDER BY chunk_id").all();
    db.close();

    await indexProject(root, { semantic: true, full: true });
    const afterDb = openDatabase(root);
    const after = afterDb.prepare("SELECT chunk_id, created_at FROM chunk_vectors ORDER BY chunk_id").all();
    afterDb.close();
    expect(after).toEqual(before);
  });

  it("keeps a previous document when its current parse fails", async () => {
    const root = fixtureRoot();
    await indexProject(root);
    const beforeRepository = new GraphRepository(openDatabase(root));
    const beforeDocument = beforeRepository.allDocuments().find((document) => document.path === "docs/auth-v2-design.md")!;
    const beforeEdges = beforeRepository.edgesFromNode(beforeDocument.id);
    beforeRepository.close();
    const target = path.join(root, "docs", "auth-v2-design.md");
    // This exceeds the parser's deterministic AST-node budget.
    fs.writeFileSync(target, Array.from({ length: 10_001 }, (_, index) => `# Heading ${index}`).join("\n"), "utf8");
    const result = await indexProject(root);
    expect(result.skipped).toBe(1);
    const repository = new GraphRepository(openDatabase(root));
    try {
      expect(repository.allDocuments().some((document) => document.path === "docs/auth-v2-design.md")).toBe(true);
      expect(repository.edgesFromNode(beforeDocument.id)).toEqual(beforeEdges);
    } finally {
      repository.close();
    }
  });

  it("reconciles links when an alias becomes ambiguous and restores it when removed", async () => {
    const root = fixtureRoot();
    fs.writeFileSync(path.join(root, "docs", "consumer.md"), "# Consumer\n\n[[Shared]]\n", "utf8");
    fs.writeFileSync(path.join(root, "docs", "first.md"), "# Shared\n", "utf8");
    await indexProject(root);
    const edgeKinds = () => { const r = new GraphRepository(openDatabase(root)); try { const d = r.allDocuments().find((x) => x.path === "docs/consumer.md")!; const section = r.allSections().find((x) => x.documentId === d.id)!; return r.edgesFromNode(section.id).filter((e) => e.kind === "LINKS_TO"); } finally { r.close(); } };
    expect(edgeKinds()).toHaveLength(1);
    fs.writeFileSync(path.join(root, "docs", "second.md"), "# Shared\n", "utf8");
    await indexProject(root);
    expect(edgeKinds()).toHaveLength(0);
    fs.renameSync(path.join(root, "docs", "second.md"), path.join(root, "docs", "second.removed"));
    await indexProject(root);
    expect(edgeKinds()).toHaveLength(1);
  });

  it("keeps normalized incremental graph equal to full and preserves unchanged edge timestamps", async () => {
    const root = fixtureRoot();
    await indexProject(root);
    const before = new GraphRepository(openDatabase(root));
    const unchanged = before.allDocuments().find((x) => x.path === "docs/redis-cache-design.md")!;
    const beforeEdge = before.edgesFromNode(unchanged.id).find((edge) => edge.kind === "CONTAINS")!;
    before.close();
    fs.appendFileSync(path.join(root, "docs", "auth-v2-design.md"), "\n`IncrementalGraphEntity` is new.\n");
    await indexProject(root);
    const incremental = normalizedGraph(root);
    const after = new GraphRepository(openDatabase(root));
    expect(after.edgesFromNode(unchanged.id).find((edge) => edge.id === beforeEdge.id)?.createdAt).toBe(beforeEdge.createdAt);
    after.close();
    await indexProject(root, { full: true });
    expect(normalizedGraph(root)).toEqual(incremental);
  });

  it("rolls back failed repository writes without advancing index metadata", async () => {
    const root = fixtureRoot();
    await indexProject(root);
    const repository = new GraphRepository(openDatabase(root));
    try {
      const state = repository.indexWriteState();
      const counts = repository.counts();
      expect(() => repository.replaceDocuments({ documents: [], sections: [], entities: [], sourceRefs: [], edges: [], chunks: [{ id: "chunk:bad", documentId: "missing", content: "bad", tokenEstimate: 1, metadata: {} }], vectors: [] }, [], [], undefined, { expectedGeneration: state.generation, extractionFingerprint: "bad" })).toThrow();
      expect(repository.counts()).toEqual(counts);
      expect(repository.indexWriteState()).toEqual(state);
    } finally { repository.close(); }
  });

  it("retries a stale asynchronous embedding snapshot instead of overwriting newer content", async () => {
    const root = fixtureRoot();
    const providerId = `delayed-${Date.now()}`;
    let release!: () => void;
    let firstStarted!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });
    let calls = 0;
    const unregister = registerEmbeddingProvider(providerId, "semantic-model", () => ({ id: providerId, model: "test", dimensions: 2, capability: "semantic-model", locality: "local-service", availability: async () => ({ status: "available" }), embedDocuments: async (inputs) => { if (calls++ === 0) { firstStarted(); await gate; } return inputs.map(() => [1, 0]); }, embedQuery: async () => [1, 0] }));
    try {
      fs.mkdirSync(path.join(root, ".mdgraph"), { recursive: true });
      fs.writeFileSync(path.join(root, ".mdgraph", "config.json"), JSON.stringify({ embedding: { enabled: true, provider: providerId, model: "test", dimensions: 2 } }));
      const slow = indexProject(root);
      await started;
      fs.appendFileSync(path.join(root, "docs", "auth-v2-design.md"), "\n`NewerConcurrentEntity` wins.\n");
      await indexProject(root);
      release();
      await slow;
      const r = new GraphRepository(openDatabase(root));
      try { expect(r.allEntities().some((entity) => entity.name === "NewerConcurrentEntity")).toBe(true); } finally { r.close(); }
    } finally { unregister(); }
  });
});

function normalizedGraph(root: string) { const r = new GraphRepository(openDatabase(root)); try { return { documents: r.allDocuments().map(({ indexedAt, updatedAt, ...x }) => x), entities: r.allEntities().map(({ createdAt, ...x }) => x), sourceRefs: r.allSourceRefs().map(({ createdAt, ...x }) => x), edges: r.allEdges().filter((x) => x.provenance !== "embedding_similarity").map(({ createdAt, ...x }) => x).sort((a, b) => a.id.localeCompare(b.id)) }; } finally { r.close(); } }

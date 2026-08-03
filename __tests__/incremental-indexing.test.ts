import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { GraphRepository } from "../src/db/repositories.js";
import { indexProject } from "../src/indexer.js";
import { createFixtureDocs } from "./fixtures.js";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("incremental indexing", () => {
  it("updates changed documents and removes deleted documents", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-incremental-"));
    tempDirs.push(root);
    createFixtureDocs(root);

    const first = await indexProject(root);
    expect(first.mode).toBe("full");

    const authPath = path.join(root, "docs", "auth-v2-design.md");
    fs.appendFileSync(authPath, "\n`AuthSessionStore` coordinates retries.\n", "utf8");
    const second = await indexProject(root);
    expect(second.mode).toBe("incremental");
    expect(second.changed).toBe(1);
    expect(second.deleted).toBe(0);

    fs.rmSync(path.join(root, "docs", "redis-cache-design.md"));
    const third = await indexProject(root);
    expect(third.mode).toBe("incremental");
    expect(third.deleted).toBe(1);
    expect(third.counts.documents).toBe(1);

    const repository = new GraphRepository(openDatabase(root));
    try {
      expect(repository.resolveNode("Redis Cache Design")).toBeUndefined();
      expect(repository.resolveNode("AuthSessionStore")?.kind).toBe("entity");
    } finally {
      repository.close();
    }
  });

  it("cleans up semantic vectors during incremental updates", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-incremental-vectors-"));
    tempDirs.push(root);
    createFixtureDocs(root);

    const first = await indexProject(root, { semantic: true });
    expect(first.counts.vectors).toBe(first.counts.chunks);

    fs.appendFileSync(path.join(root, "docs", "auth-v2-design.md"), "\n## AuthSessionStore\n\n`AuthSessionStore` coordinates retries.\n", "utf8");
    const second = await indexProject(root, { semantic: true });
    expect(second.changed).toBe(1);
    expect(second.counts.vectors).toBe(second.counts.chunks);

    fs.rmSync(path.join(root, "docs", "redis-cache-design.md"));
    const third = await indexProject(root, { semantic: true });
    expect(third.deleted).toBe(1);
    expect(third.counts.vectors).toBe(third.counts.chunks);

    const db = openDatabase(root);
    try {
      const orphanRow = db.prepare(`
        SELECT count(*) AS count
        FROM chunk_vectors vector
        LEFT JOIN chunks chunk ON chunk.id = vector.chunk_id
        WHERE chunk.id IS NULL
      `).get() as { count: number };
      expect(orphanRow.count).toBe(0);
    } finally {
      db.close();
    }
  });
});

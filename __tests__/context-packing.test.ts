import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load-config.js";
import { openDatabase } from "../src/db/connection.js";
import { GraphRepository } from "../src/db/repositories.js";
import { indexProject } from "../src/indexer.js";
import { ToolHandler, tools } from "../src/mcp/tools.js";
import { buildContext } from "../src/query/context-builder.js";
import { createFixtureDocs } from "./fixtures.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("context packing surfaces", () => {
  it("uses stored vectors when available and reports MMR selection diagnostics", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-context-packing-surface-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    await indexProject(root, { full: true, semantic: true });

    const repository = new GraphRepository(openDatabase(root));
    try {
      const context = buildContext(repository, loadConfig(root), "AuthService RedisTimeoutError", {
        debug: true,
        packingStrategy: "mmr"
      });
      expect(context.packing).toMatchObject({
        strategy: "mmr",
        similarity: "embedding-cosine",
        mmrLambda: 0.65
      });
      expect(context.debug?.packingSelections?.length).toBe(context.items.length);
      expect(context.debug?.packingSelections?.every((selection) => (
        selection.queryRelevance >= 0
        && selection.redundancyPenalty >= 0
        && Number.isFinite(selection.mmrScore)
      ))).toBe(true);
    } finally {
      repository.close();
    }

    const cli = spawnSync(process.execPath, [
      "dist/bin/mdgraph.js",
      "context",
      "AuthService RedisTimeoutError",
      "--packing",
      "mmr",
      "--mmr-lambda",
      "0.5",
      "--debug",
      "--json",
      "--path",
      root
    ], { cwd: path.resolve("."), encoding: "utf8" });
    expect(cli.status, cli.stderr).toBe(0);
    expect(JSON.parse(cli.stdout)).toMatchObject({
      packing: { strategy: "mmr", mmrLambda: 0.5 },
      debug: { packingStrategy: "mmr", mmrLambda: 0.5 }
    });
  });

  it("keeps five MCP tools while adding an optional context packing selector", async () => {
    const definition = tools.find((tool) => tool.name === "mdgraph_context");
    expect(tools).toHaveLength(5);
    expect(definition?.inputSchema.properties.packingStrategy).toMatchObject({
      type: "string",
      enum: ["mmr-style-document-round-robin", "mmr"]
    });

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-context-packing-mcp-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    await indexProject(root, { full: true });
    const result = await new ToolHandler(root).executeAsync("mdgraph_context", {
      query: "AuthService",
      packingStrategy: "mmr"
    });
    expect(result.structuredContent).toMatchObject({
      context: { packing: { strategy: "mmr", similarity: "lexical-jaccard" } }
    });
  });
});

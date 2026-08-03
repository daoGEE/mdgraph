import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { databasePath } from "../src/config/load-config.js";
import { indexProject } from "../src/indexer.js";
import { ToolHandler } from "../src/mcp/tools.js";
import { watchProject } from "../src/watcher/file-watcher.js";
import { createFixtureDocs } from "./fixtures.js";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("watch mode", () => {
  it("creates the graph database when watch starts", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-watch-start-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    const indexedResults: Awaited<ReturnType<typeof indexProject>>[] = [];

    expect(fs.existsSync(databasePath(root))).toBe(false);
    const handle = await watchProject(root, {
      debounceMs: 10,
      onIndexed: (result) => {
        indexedResults.push(result);
      }
    });

    try {
      expect(fs.existsSync(databasePath(root))).toBe(true);
      expect(indexedResults).toHaveLength(1);
      expect(indexedResults[0].mode).toBe("full");
      expect(indexedResults[0].counts.documents).toBe(2);
    } finally {
      await handle.close();
    }
  });

  it("ignores non-Markdown file changes while watch mode is active", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-watch-noise-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    const indexedResults: Awaited<ReturnType<typeof indexProject>>[] = [];

    const handle = await watchProject(root, {
      debounceMs: 10,
      onIndexed: (result) => {
        indexedResults.push(result);
      }
    });

    try {
      expect(indexedResults).toHaveLength(1);

      fs.writeFileSync(path.join(root, "notes.txt"), "noise that should not trigger reindex\n", "utf8");
      await delay(300);

      expect(indexedResults).toHaveLength(1);
    } finally {
      await handle.close();
    }
  });

  it("keeps MCP tool calls fresh after watched Markdown changes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-watch-mcp-fresh-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    const indexedResults: Awaited<ReturnType<typeof indexProject>>[] = [];
    const waiters: Array<() => void> = [];
    const handle = await watchProject(root, {
      debounceMs: 10,
      onIndexed: (result) => {
        indexedResults.push(result);
        for (const waiter of waiters.splice(0)) {
          waiter();
        }
      }
    });

    try {
      const handler = new ToolHandler(root);
      expect(handler.execute("mdgraph_search", { query: "FreshService" }).content[0].text).toContain("No MDGraph search results");

      fs.appendFileSync(path.join(root, "docs", "auth-v2-design.md"), "\n## Fresh Service\n\n`FreshService` is added while watch mode is active.\n", "utf8");

      await waitForIndexCount(indexedResults, waiters, 2);
      expect(handler.execute("mdgraph_search", { query: "FreshService" }).content[0].text).toContain("auth-v2-design.md");
    } finally {
      await handle.close();
    }
  }, 10000);
});

function waitForIndexCount(
  indexedResults: Awaited<ReturnType<typeof indexProject>>[],
  waiters: Array<() => void>,
  count: number
): Promise<void> {
  if (indexedResults.length >= count) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      const index = waiters.indexOf(onIndexed);
      if (index >= 0) {
        waiters.splice(index, 1);
      }
      reject(new Error(`Timed out waiting for ${count} watch index result(s); saw ${indexedResults.length}.`));
    }, 8000);
    const onIndexed = (): void => {
      if (indexedResults.length < count) {
        waiters.push(onIndexed);
        return;
      }
      clearTimeout(timeout);
      resolve();
    };
    waiters.push(onIndexed);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

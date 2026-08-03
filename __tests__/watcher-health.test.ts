import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WATCHER_FAILURE_BASELINE_CASES } from "../src/evaluation/historical-baseline.js";
import { ToolHandler } from "../src/mcp/tools.js";
import { watchProject } from "../src/watcher/file-watcher.js";
import { WatchHealthTracker } from "../src/watcher/watch-health.js";
import { createFixtureDocs } from "./fixtures.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("watcher health", () => {
  it("maps versioned watcher failure fixtures to fatal or degraded persistent states", () => {
    for (const fixture of WATCHER_FAILURE_BASELINE_CASES) {
      const tracker = new WatchHealthTracker(false);
      if (fixture.phase !== "startup") {
        tracker.recordReady("2026-07-21T00:00:00.000Z");
      }
      const error = Object.assign(new Error(`${fixture.code} fixture`), {
        code: fixture.code === "INDEX_ERROR" ? "EIO" : fixture.code
      });
      tracker.recordError(error, fixture.phase, "2026-07-21T00:00:01.000Z");
      const health = tracker.snapshot();

      expect(health.state).toBe(fixture.expectedFuturePolicy === "fatal" ? "failed" : "degraded");
      expect(health.lastError?.code).toBe(fixture.code);
      expect(health.lastError?.phase).toBe(fixture.phase);
      expect(health.lastError?.fatal).toBe(fixture.expectedFuturePolicy === "fatal");
    }
  });

  it("recovers from indexing failures but keeps runtime coverage failures degraded", () => {
    const indexing = new WatchHealthTracker(false);
    indexing.recordReady("2026-07-21T00:00:00.000Z");
    indexing.recordError(new Error("index failed"), "indexing", "2026-07-21T00:00:01.000Z");
    indexing.recordIndexSuccess("2026-07-21T00:00:02.000Z");
    expect(indexing.snapshot()).toMatchObject({
      state: "healthy",
      lastSuccessfulIndexAt: "2026-07-21T00:00:02.000Z",
      consecutiveIndexFailures: 0,
      coverageReliable: true
    });

    const runtime = new WatchHealthTracker(false);
    runtime.recordReady("2026-07-21T00:00:00.000Z");
    runtime.recordError(Object.assign(new Error("watch limit"), { code: "ENOSPC" }), "runtime", "2026-07-21T00:00:01.000Z");
    runtime.recordIndexSuccess("2026-07-21T00:00:02.000Z");
    expect(runtime.snapshot()).toMatchObject({ state: "degraded", coverageReliable: false });
  });

  it("exposes live health through the watch handle and MCP status", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-watcher-health-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    const handle = await watchProject(root, { debounceMs: 10, usePolling: true });

    expect(handle.getHealth()).toMatchObject({
      state: "healthy",
      polling: true,
      coverageReliable: true,
      consecutiveIndexFailures: 0,
      closed: false
    });
    expect(handle.getHealth().lastSuccessfulIndexAt).toBeTruthy();

    const status = new ToolHandler(root, root, () => handle.getHealth()).execute("mdgraph_status");
    expect(status.content[0].text).toContain("Watch health: healthy (polling)");
    expect(status.structuredContent).toMatchObject({
      watchHealth: { state: "healthy", polling: true }
    });

    await handle.close();
    expect(handle.getHealth().closed).toBe(true);
  });

  it("reports configuration and setup failures as fatal startup health", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-watcher-startup-"));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, ".mdgraph"), { recursive: true });
    fs.writeFileSync(path.join(root, ".mdgraph", "config.json"), "{not-json", "utf8");
    const health: Array<ReturnType<WatchHealthTracker["snapshot"]>> = [];
    const errors: Error[] = [];

    await expect(watchProject(root, {
      onHealthChanged: (snapshot) => health.push(snapshot),
      onError: (error) => errors.push(error)
    })).rejects.toThrow();

    expect(errors).toHaveLength(1);
    expect(health.at(-1)).toMatchObject({
      state: "failed",
      closed: true,
      lastError: { phase: "startup", fatal: true }
    });
  });

  it.skipIf(process.platform === "win32")("ignores Unix sockets in excluded directories without disabling native watch", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-watcher-socket-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    const codegraphDir = path.join(root, ".codegraph");
    const socketPath = path.join(codegraphDir, "daemon.sock");
    fs.mkdirSync(codegraphDir, { recursive: true });

    const socketServer = net.createServer();
    await new Promise<void>((resolve, reject) => {
      socketServer.once("error", reject);
      socketServer.listen(socketPath, resolve);
    });

    const indexedResults: unknown[] = [];
    let handle: Awaited<ReturnType<typeof watchProject>> | undefined;
    try {
      handle = await watchProject(root, {
        debounceMs: 10,
        onIndexed: (result) => indexedResults.push(result)
      });
      expect(handle.getHealth()).toMatchObject({ state: "healthy", polling: false });
      expect(indexedResults).toHaveLength(1);

      fs.appendFileSync(
        path.join(root, "docs", "auth-v2-design.md"),
        "\n## Socket Watch Service\n\n`SocketWatchService` verifies native watch coverage.\n",
        "utf8"
      );
      await waitFor(() => indexedResults.length >= 2);
      expect(handle.getHealth()).toMatchObject({ state: "healthy", coverageReliable: true });
    } finally {
      await handle?.close();
      await new Promise<void>((resolve, reject) => {
        socketServer.close((error) => error ? reject(error) : resolve());
      });
    }
  }, 10000);
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8000) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for watcher update.");
}

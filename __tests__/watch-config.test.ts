import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { watchProject } from "../src/watcher/file-watcher.js";
import { createFixtureDocs } from "./fixtures.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("watch configuration reload", () => {
  it("reloads parseMdx and gitignore rules after their control files change", async () => {
    const root = fixtureRoot();
    writeConfig(root, {});
    const results: unknown[] = [];
    const handle = await watchProject(root, { debounceMs: 10, onIndexed: (result) => results.push(result) });
    try {
      writeConfig(root, { index: { parseMdx: true, followGitignore: true } });
      await waitFor(() => results.length >= 2);
      fs.writeFileSync(path.join(root, "docs", "live.mdx"), "# Live MDX\n\n`MdxWatcher` is indexed.\n", "utf8");
      await waitFor(() => results.length >= 3);

      fs.writeFileSync(path.join(root, ".gitignore"), "docs/ignored.md\n", "utf8");
      await waitFor(() => results.length >= 4);
      fs.writeFileSync(path.join(root, "docs", "ignored.md"), "# Ignored\n\n`IgnoredWatcher` must stay out.\n", "utf8");
      await delay(300);
      expect(results).toHaveLength(4);
    } finally { await handle.close(); }
  }, 10000);

  it("keeps the active watcher through invalid config and recovers after repair", async () => {
    const root = fixtureRoot();
    writeConfig(root, {});
    const errors: Error[] = [];
    const handle = await watchProject(root, { debounceMs: 10, onError: (error) => errors.push(error) });
    try {
      fs.writeFileSync(path.join(root, ".mdgraph", "config.json"), "{ invalid", "utf8");
      await waitFor(() => handle.getHealth().state === "degraded");
      expect(errors.at(-1)?.message).toContain("Invalid MDGraph config");

      const beforeRecovery = handle.getHealth().lastSuccessfulIndexAt;
      writeConfig(root, { index: { parseMdx: true } });
      await waitFor(() => handle.getHealth().state === "healthy" && handle.getHealth().lastSuccessfulIndexAt !== beforeRecovery);
      fs.writeFileSync(path.join(root, "docs", "recovered.mdx"), "# Recovered\n\n`RecoveredWatcher` works.\n", "utf8");
      const beforeMdx = handle.getHealth().lastSuccessfulIndexAt;
      await waitFor(() => handle.getHealth().lastSuccessfulIndexAt !== beforeMdx);
    } finally { await handle.close(); }
  }, 10000);
});

function fixtureRoot(): string { const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-watch-config-")); roots.push(root); createFixtureDocs(root); return root; }
function writeConfig(root: string, config: unknown): void { fs.mkdirSync(path.join(root, ".mdgraph"), { recursive: true }); fs.writeFileSync(path.join(root, ".mdgraph", "config.json"), JSON.stringify(config), "utf8"); }
async function waitFor(predicate: () => boolean): Promise<void> { const deadline = Date.now() + 8000; while (Date.now() < deadline) { if (predicate()) return; await delay(25); } throw new Error("Timed out waiting for watcher state."); }
function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { indexProject } from "../src/indexer.js";
import { ToolHandler, tools } from "../src/mcp/tools.js";

const cli = path.resolve(__dirname, "../dist/bin/mdgraph.js");

it("returns the same bounded ownership card through CLI and the unchanged MCP tool", async () => {
  const root = fixture();
  await indexProject(root);
  const query = "README.md#watering";
  const result = run(root, ["node", query, "--json"]);
  expect(result.status).toBe(0);
  const card = JSON.parse(result.stdout).card;
  const mcp = new ToolHandler(root).execute("mdgraph_node", { query });
  expect((mcp.structuredContent as any).node.card).toEqual(card);
  expect(tools).toHaveLength(5);
  expect(JSON.stringify(card).length).toBeLessThanOrEqual(4000);
  expect(card.definitions).toContainEqual(expect.objectContaining({ label: "OrchardScheduler", association: "inherited", originNodeId: expect.any(String) }));
  expect(card.nextReads.length).toBeGreaterThan(0);
  expect(card.nextReads.every((item: any) => item.path && item.reason && item.nodeId !== card.nodeId)).toBe(true);
  expect(mcp.content[0].text).toContain("inherited");
});

it("migrates and updates plans through installed CLI syntax without overwriting the source plan", async () => {
  const root = fixture();
  await indexProject(root);
  const created = run(root, ["wiki", "plan", "--wiki-dir", "handbook", "--out", "initial.json", "--json"]);
  expect(created.status).toBe(0);
  const v2 = JSON.parse(created.stdout).plan;
  const v1 = { ...v2, formatVersion: 1, wikiDir: undefined, suggestions: undefined, pages: v2.pages.map((page: any) => ({ ...page, dependencySnapshot: undefined, title: "Maintainer's Orchard Guide" })) };
  fs.writeFileSync(path.join(root, "legacy.json"), JSON.stringify(v1));
  const before = fs.readFileSync(path.join(root, "legacy.json"), "utf8");
  expect(run(root, ["wiki", "plan", "--from", "legacy.json", "--out", "next.json"]).status).toBe(1);
  const migrated = run(root, ["wiki", "plan", "--from", "legacy.json", "--wiki-dir", "handbook", "--out", "next.json", "--json"]);
  expect(migrated.status).toBe(0);
  expect(JSON.parse(migrated.stdout).plan).toMatchObject({ formatVersion: 2, wikiDir: "handbook", pages: [expect.objectContaining({ title: "Maintainer's Orchard Guide" })] });
  expect(fs.readFileSync(path.join(root, "legacy.json"), "utf8")).toBe(before);
  expect(run(root, ["wiki", "plan", "--from", "legacy.json", "--wiki-dir", "handbook", "--out", "legacy.json"]).status).toBe(1);
  const brief = run(root, ["wiki", "brief", v2.pages[0].id, "--plan", "next.json", "--json"]);
  expect(brief.status).toBe(0);
  expect(JSON.parse(brief.stdout)).toMatchObject({ dependencyEvidence: { state: "fresh" }, sourceInspections: expect.any(Array), supplementaryDocuments: expect.any(Array) });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-wiki-contract-"));
  fs.writeFileSync(path.join(root, "README.md"), "---\ndefines: [OrchardScheduler]\n---\n# Orchard\n\nSchedule watering.\n\n## Watering\n\nWater selected zones.\n");
  return root;
}
function run(root: string, args: string[]) { return spawnSync(process.execPath, [cli, ...args, "--path", root], { encoding: "utf8" }); }

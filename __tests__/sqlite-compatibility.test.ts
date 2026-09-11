import { expect, it } from "vitest";
import { createDatabase } from "../src/db/sqlite-adapter.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../src/db/connection.js";

it("normalizes empty rows without losing real NULL rows and closes once", () => {
  const db = createDatabase(":memory:");
  expect(db.prepare("SELECT 1 AS value WHERE 0").get()).toBeUndefined();
  expect(db.prepare("SELECT NULL AS value").get()).toEqual({ value: null });
  expect(db.prepare("SELECT ? AS value").get(42)).toEqual({ value: 42 });
  db.close();
  expect(() => db.close()).not.toThrow();
  expect(() => db.prepare("SELECT 1")).toThrow();
});

it("opens FTS5-enabled builds or supplies recovery before changing the persistent schema", () => {
  const probe = createDatabase(":memory:");
  let supported = true;
  try { probe.exec("CREATE VIRTUAL TABLE sample USING fts5(content)"); } catch { supported = false; }
  probe.close();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-sqlite-capability-"));
  if (supported) {
    const db = openDatabase(root);
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='chunks_fts'").get()).toBeDefined();
    db.close();
  } else {
    expect(() => openDatabase(root)).toThrow(/FTS5.*Upgrade/);
    const db = createDatabase(path.join(root, ".mdgraph/graph.db"));
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='schema_metadata'").get()).toBeUndefined();
    db.close();
  }
});

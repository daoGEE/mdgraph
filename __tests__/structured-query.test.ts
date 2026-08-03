import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { GraphRepository } from "../src/db/repositories.js";
import { indexProject } from "../src/indexer.js";
import { StructuredQueryExecutionError, executeStructuredQuery } from "../src/query/structured-query-executor.js";
import {
  StructuredQuerySyntaxError,
  parseStructuredQuery,
  tokenizeStructuredQuery
} from "../src/query/structured-query.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("structured query parser", () => {
  it("tokenizes quoted values and builds a typed AST with boolean precedence, sort, and limit", () => {
    const query = "type:adr OR type = runbook AND status != draft ORDER BY updated DESC, path ASC LIMIT 10";
    expect(tokenizeStructuredQuery(query).filter((token) => token.kind === "operator").map((token) => token.value)).toContain("=");
    const ast = parseStructuredQuery(query);

    expect(ast.expression).toMatchObject({
      kind: "or",
      left: { kind: "predicate", field: "type", operator: "=", value: "adr" },
      right: {
        kind: "and",
        left: { kind: "predicate", field: "type", operator: "=", value: "runbook" },
        right: { kind: "predicate", field: "status", operator: "!=", value: "draft" }
      }
    });
    expect(ast.orderBy).toEqual([
      { field: "updated", direction: "desc" },
      { field: "path", direction: "asc" }
    ]);
    expect(ast.limit).toBe(10);
  });

  it("rejects unknown fields, enum values, operators, dates, excessive limits, and malformed input", () => {
    const invalid = [
      "owner = platform",
      "type = unknown",
      "trust = root",
      "edge.UNKNOWN = auth",
      "health = haunted",
      "updated >= 2026-99-99",
      "status > accepted",
      "type = adr LIMIT 501",
      "type = 'adr",
      "(type = adr"
    ];
    for (const query of invalid) {
      expect(() => parseStructuredQuery(query), query).toThrow(StructuredQuerySyntaxError);
    }
  });

  it("enforces query length, token, and nesting budgets", () => {
    expect(() => tokenizeStructuredQuery("x".repeat(10_001))).toThrow(/10000 characters/u);
    expect(() => tokenizeStructuredQuery("status = active ".repeat(86))).toThrow(/256 tokens/u);
    expect(() => parseStructuredQuery(`${"NOT ".repeat(25)}type = adr`)).toThrow(/nesting exceeds 24/u);
  });
});

describe("structured query execution", () => {
  it("filters document metadata and outgoing graph edges with parameterized SQL", async () => {
    const root = await structuredFixture();
    const repository = new GraphRepository(openDatabase(root));
    try {
      const result = await executeStructuredQuery(
        repository,
        root,
        "type:adr AND status = accepted AND tag = security AND edge.IMPLEMENTS ~ auth"
      );

      expect(result.execution).toMatchObject({
        strategy: "parameterized-sql",
        stages: ["document", "metadata", "graph"],
        doctorHealthEvaluated: false
      });
      expect(result.execution.parameterCount).toBeGreaterThan(4);
      expect(result.total).toBe(1);
      expect(result.items.map((item) => item.document.path)).toEqual(["docs/adrs/auth.md"]);
      expect(result.items[0].document.updatedAt).toBe("2026-07-01T00:00:00.000Z");

      const genericEdge = await executeStructuredQuery(repository, root, "type = adr AND edge = implements");
      expect(genericEdge.items.map((item) => item.document.path)).toEqual(["docs/adrs/auth.md"]);
    } finally {
      repository.close();
    }
  });

  it("preserves AND/OR/NOT semantics, deterministic ordering, and limit diagnostics", async () => {
    const root = await structuredFixture();
    const repository = new GraphRepository(openDatabase(root));
    try {
      const precedence = await executeStructuredQuery(
        repository,
        root,
        "type = adr OR type = runbook AND NOT status = draft ORDER BY path ASC"
      );
      expect(precedence.items.map((item) => item.document.path)).toEqual([
        "docs/adrs/auth-next.md",
        "docs/adrs/auth.md",
        "docs/runbooks/auth.md",
        "docs/runbooks/healthy.md"
      ]);

      const limited = await executeStructuredQuery(repository, root, "type = adr ORDER BY updated DESC LIMIT 1");
      expect(limited.total).toBe(2);
      expect(limited.returned).toBe(1);
      expect(limited.truncated).toBe(true);
      expect(limited.items[0].document.path).toBe("docs/adrs/auth.md");

      const recent = await executeStructuredQuery(repository, root, "updated >= 2026-07-01 ORDER BY updated ASC");
      expect(recent.items.map((item) => item.document.path)).toEqual([
        "docs/adrs/auth.md",
        "docs/runbooks/auth.md"
      ]);
    } finally {
      repository.close();
    }
  });

  it("combines doctor-derived health with storage predicates without breaking OR semantics", async () => {
    const root = await structuredFixture();
    const repository = new GraphRepository(openDatabase(root));
    try {
      const deadRunbooks = await executeStructuredQuery(repository, root, "type = runbook AND health = dead_link");
      expect(deadRunbooks.execution).toMatchObject({
        strategy: "parameterized-hybrid-doctor",
        stages: ["document", "doctor"],
        doctorHealthEvaluated: true
      });
      expect(deadRunbooks.items.map((item) => item.document.path)).toEqual(["docs/runbooks/auth.md"]);

      const union = await executeStructuredQuery(repository, root, "health = dead_link OR status = accepted ORDER BY path");
      expect(union.items.map((item) => item.document.path)).toEqual([
        "docs/adrs/auth.md",
        "docs/runbooks/auth.md"
      ]);
    } finally {
      repository.close();
    }
  });

  it("refuses doctor-derived health predicates when the index is stale", async () => {
    const root = await structuredFixture();
    fs.appendFileSync(path.join(root, "docs", "runbooks", "auth.md"), "\nChanged after indexing.\n", "utf8");
    const repository = new GraphRepository(openDatabase(root));
    try {
      await expect(executeStructuredQuery(repository, root, "health = dead_link"))
        .rejects.toThrow(StructuredQueryExecutionError);
    } finally {
      repository.close();
    }
  });

  it("treats SQL-looking values as data and leaves the index intact", async () => {
    const root = await structuredFixture();
    const repository = new GraphRepository(openDatabase(root));
    try {
      const before = repository.counts();
      const result = await executeStructuredQuery(repository, root, "title = '\" OR 1=1 --'");
      expect(result.items).toEqual([]);
      expect(repository.counts()).toEqual(before);
      expect(repository.allDocuments()).toHaveLength(5);
    } finally {
      repository.close();
    }
  });

  it("exposes the experimental query command without changing search or MCP", async () => {
    const root = await structuredFixture();
    const cli = spawnSync(process.execPath, [
      "dist/bin/mdgraph.js",
      "query",
      "type:adr AND status:accepted ORDER BY path LIMIT 5",
      "--json",
      "--path",
      root
    ], { cwd: path.resolve("."), encoding: "utf8" });

    expect(cli.status, cli.stderr).toBe(0);
    expect(JSON.parse(cli.stdout)).toMatchObject({
      execution: { strategy: "parameterized-sql" },
      total: 1,
      returned: 1,
      items: [{ document: { path: "docs/adrs/auth.md" } }]
    });
  });
});

async function structuredFixture(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-structured-query-"));
  tempDirs.push(root);
  writeDocument(root, "docs/adrs/auth.md", "2026-07-01T00:00:00.000Z", `---
title: Auth Decision
type: adr
status: accepted
tags: [security, auth]
defines: [AuthDecision]
implements: [src/auth/service.ts]
---
# Auth Decision

The accepted authentication decision.
`);
  writeDocument(root, "docs/adrs/auth-next.md", "2026-06-01T00:00:00.000Z", `---
title: Auth Next
type: adr
status: proposed
tags: [auth]
defines: [AuthNext]
---
# Auth Next

The proposed authentication decision.
`);
  writeDocument(root, "docs/runbooks/auth.md", "2026-07-15T00:00:00.000Z", `---
title: Auth Runbook
type: runbook
status: active
tags: [security]
defines: [AuthRunbook]
---
# Auth Runbook

[Missing recovery details](../missing.md)
`);
  writeDocument(root, "docs/runbooks/healthy.md", "2026-05-01T00:00:00.000Z", `---
title: Healthy Runbook
type: runbook
status: active
defines: [HealthyRunbook]
depends_on: [Auth Decision]
---
# Healthy Runbook

See [[Auth Decision]].
`);
  writeDocument(root, "docs/incidents/auth.md", "2026-04-01T00:00:00.000Z", `---
title: Auth Incident
type: incident
status: closed
---
# Auth Incident

Historical notes.
`);
  await indexProject(root, { full: true });
  return root;
}

function writeDocument(root: string, relativePath: string, modifiedAt: string, content: string): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  const modified = new Date(modifiedAt);
  fs.utimesSync(target, modified, modified);
}
import { spawnSync } from "node:child_process";

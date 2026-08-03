import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { openDatabase } from "../db/connection.js";
import { GraphRepository } from "../db/repositories.js";
import { indexProject } from "../indexer.js";
import { executeStructuredQuery } from "../query/structured-query-executor.js";

export const STRUCTURED_QUERY_EVALUATION_VERSION = 1;
export const STRUCTURED_QUERY_GATES = {
  minimumCaseAccuracy: 1,
  requireParameterizedExecution: true,
  requireInjectionIsolation: true
} as const;

interface StructuredQueryCase {
  id: string;
  query: string;
  expectedPaths: string[];
  expectedStrategy: "parameterized-sql" | "parameterized-hybrid-doctor";
}

export interface StructuredQueryEvaluationReport {
  evaluationVersion: typeof STRUCTURED_QUERY_EVALUATION_VERSION;
  cases: Array<{
    id: string;
    query: string;
    expectedPaths: string[];
    observedPaths: string[];
    strategy: "parameterized-sql" | "parameterized-hybrid-doctor";
    parameterCount: number;
    passed: boolean;
    latencyMs: number;
  }>;
  caseAccuracy: number;
  parameterizedExecution: boolean;
  injectionIsolation: boolean;
  maximumLatencyMs: number;
  gates: typeof STRUCTURED_QUERY_GATES;
  passed: boolean;
  elapsedMs: number;
}

const CASES: StructuredQueryCase[] = [
  {
    id: "accepted-auth-adr",
    query: "type:adr AND status:accepted AND edge.IMPLEMENTS ~ auth",
    expectedPaths: ["docs/adrs/auth.md"],
    expectedStrategy: "parameterized-sql"
  },
  {
    id: "active-dead-link-runbook",
    query: "type:runbook AND status:active AND health:dead_link",
    expectedPaths: ["docs/runbooks/auth.md"],
    expectedStrategy: "parameterized-hybrid-doctor"
  },
  {
    id: "recent-documents",
    query: "updated >= 2026-07-01 ORDER BY updated ASC, path ASC",
    expectedPaths: ["docs/adrs/auth.md", "docs/runbooks/auth.md"],
    expectedStrategy: "parameterized-sql"
  },
  {
    id: "boolean-union",
    query: "status:accepted OR health:dead_link ORDER BY path",
    expectedPaths: ["docs/adrs/auth.md", "docs/runbooks/auth.md"],
    expectedStrategy: "parameterized-hybrid-doctor"
  }
];

export async function runStructuredQueryEvaluation(): Promise<StructuredQueryEvaluationReport> {
  const started = performance.now();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-structured-query-eval-"));
  try {
    writeEvaluationFixture(root);
    await indexProject(root, { full: true });
    const repository = new GraphRepository(openDatabase(root));
    try {
      const cases = [] as StructuredQueryEvaluationReport["cases"];
      for (const evaluationCase of CASES) {
        const caseStarted = performance.now();
        const result = await executeStructuredQuery(repository, root, evaluationCase.query);
        const observedPaths = result.items.map((item) => item.document.path);
        cases.push({
          id: evaluationCase.id,
          query: evaluationCase.query,
          expectedPaths: evaluationCase.expectedPaths,
          observedPaths,
          strategy: result.execution.strategy,
          parameterCount: result.execution.parameterCount,
          passed: arraysEqual(observedPaths, evaluationCase.expectedPaths)
            && result.execution.strategy === evaluationCase.expectedStrategy,
          latencyMs: elapsed(caseStarted)
        });
      }

      const countsBeforeInjection = repository.counts();
      const injection = await executeStructuredQuery(repository, root, "title = '\" OR 1=1 --'");
      const injectionIsolation = injection.total === 0
        && JSON.stringify(repository.counts()) === JSON.stringify(countsBeforeInjection);
      const caseAccuracy = ratio(cases.filter((item) => item.passed).length, cases.length);
      const parameterizedExecution = cases.every((item) => item.parameterCount > 0);
      const maximumLatencyMs = Math.max(...cases.map((item) => item.latencyMs), 0);
      const passed = caseAccuracy >= STRUCTURED_QUERY_GATES.minimumCaseAccuracy
        && (!STRUCTURED_QUERY_GATES.requireParameterizedExecution || parameterizedExecution)
        && (!STRUCTURED_QUERY_GATES.requireInjectionIsolation || injectionIsolation);
      return {
        evaluationVersion: STRUCTURED_QUERY_EVALUATION_VERSION,
        cases,
        caseAccuracy,
        parameterizedExecution,
        injectionIsolation,
        maximumLatencyMs,
        gates: STRUCTURED_QUERY_GATES,
        passed,
        elapsedMs: elapsed(started)
      };
    } finally {
      repository.close();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeEvaluationFixture(root: string): void {
  writeDocument(root, "docs/adrs/auth.md", "2026-07-01T00:00:00.000Z", `---
title: Auth Decision
type: adr
status: accepted
tags: [security, auth]
defines: [AuthDecision]
implements: [src/auth/service.ts]
---
# Auth Decision

Accepted authentication architecture.
`);
  writeDocument(root, "docs/adrs/next.md", "2026-06-01T00:00:00.000Z", `---
title: Next Decision
type: adr
status: proposed
defines: [NextDecision]
---
# Next Decision

Proposed architecture.
`);
  writeDocument(root, "docs/runbooks/auth.md", "2026-07-15T00:00:00.000Z", `---
title: Auth Runbook
type: runbook
status: active
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
}

function writeDocument(root: string, relativePath: string, modifiedAt: string, content: string): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  const modified = new Date(modifiedAt);
  fs.utimesSync(target, modified, modified);
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function ratio(numerator: number, denominator: number): number {
  return denominator ? Number((numerator / denominator).toFixed(4)) : 0;
}

function elapsed(started: number): number {
  return Number((performance.now() - started).toFixed(2));
}

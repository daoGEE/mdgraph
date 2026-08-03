import { describe, expect, it } from "vitest";
import {
  STRUCTURED_QUERY_EVALUATION_VERSION,
  STRUCTURED_QUERY_GATES,
  runStructuredQueryEvaluation
} from "../src/evaluation/structured-query-evaluation.js";

describe("structured query evaluation", () => {
  it("meets deterministic correctness, parameterization, and injection-isolation gates", async () => {
    const report = await runStructuredQueryEvaluation();

    expect(report.evaluationVersion).toBe(STRUCTURED_QUERY_EVALUATION_VERSION);
    expect(report.caseAccuracy).toBeGreaterThanOrEqual(STRUCTURED_QUERY_GATES.minimumCaseAccuracy);
    expect(report.parameterizedExecution).toBe(true);
    expect(report.injectionIsolation).toBe(true);
    expect(report.cases.every((evaluationCase) => evaluationCase.passed)).toBe(true);
    expect(report.passed).toBe(true);
  });
});

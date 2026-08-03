import { describe, expect, it } from "vitest";
import {
  CONTEXT_PACKING_EVALUATION_VERSION,
  CONTEXT_PACKING_GATES,
  runContextPackingEvaluation
} from "../src/evaluation/context-packing-evaluation.js";

describe("context packing evaluation", () => {
  it("reduces redundant context without sacrificing expected document recall", async () => {
    const report = await runContextPackingEvaluation();

    expect(report.evaluationVersion).toBe(CONTEXT_PACKING_EVALUATION_VERSION);
    expect(report.baseline.packingStrategy).toBe("mmr-style-document-round-robin");
    expect(report.mmr.packingStrategy).toBe("mmr");
    expect(report.mmr.packingSimilarity).toBe("lexical-jaccard");
    expect(report.redundancyReduction).toBeGreaterThanOrEqual(CONTEXT_PACKING_GATES.minimumRedundancyReduction);
    expect(report.documentRecallDrop).toBeLessThanOrEqual(CONTEXT_PACKING_GATES.maximumDocumentRecallDrop);
    expect(report.mmr.nearDuplicatePairs).toBeLessThan(report.baseline.nearDuplicatePairs);
    expect(report.mmr.redundancySkippedItems).toBeGreaterThan(0);
    expect(report.mmr.budgetFit).toBe(true);
    expect(report.passed).toBe(true);
  });
});

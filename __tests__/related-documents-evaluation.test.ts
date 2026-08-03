import { describe, expect, it } from "vitest";
import {
  RELATED_DOCUMENTS_GATES,
  runRelatedDocumentsEvaluation
} from "../src/evaluation/related-documents-evaluation.js";

describe("derived relationship evaluation", () => {
  it("meets precision, recall, provenance, and replacement gates", async () => {
    const report = await runRelatedDocumentsEvaluation();
    expect(report.precision).toBeGreaterThanOrEqual(RELATED_DOCUMENTS_GATES.minimumPrecision);
    expect(report.recall).toBeGreaterThanOrEqual(RELATED_DOCUMENTS_GATES.minimumRecall);
    expect(report.completeProvenance).toBe(true);
    expect(report.deterministicReplacement).toBe(true);
    expect(report.falsePositives).toEqual([]);
    expect(report.falseNegatives).toEqual([]);
    expect(report.relationshipPairs).toBe(2);
    expect(report.directedEdges).toBe(4);
    expect(report.passed).toBe(true);
  });
});

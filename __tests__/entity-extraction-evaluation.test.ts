import { describe, expect, it } from "vitest";
import {
  ENTITY_EXTRACTION_EVALUATION_VERSION,
  ENTITY_EXTRACTION_EXPECTED,
  ENTITY_EXTRACTION_GATES,
  ENTITY_EXTRACTION_NOISE,
  runEntityExtractionEvaluation
} from "../src/evaluation/entity-extraction-evaluation.js";

describe("entity extraction evaluation", () => {
  it("meets the annotated precision and recall gates across Latin and CJK entities", () => {
    const report = runEntityExtractionEvaluation();

    expect(report.evaluationVersion).toBe(ENTITY_EXTRACTION_EVALUATION_VERSION);
    expect(report.expected).toEqual(ENTITY_EXTRACTION_EXPECTED);
    expect(report.expectedNoise).toEqual(ENTITY_EXTRACTION_NOISE);
    expect(report.precision).toBeGreaterThanOrEqual(ENTITY_EXTRACTION_GATES.minimumPrecision);
    expect(report.recall).toBeGreaterThanOrEqual(ENTITY_EXTRACTION_GATES.minimumRecall);
    expect(report.cjkRecall).toBeGreaterThanOrEqual(ENTITY_EXTRACTION_GATES.minimumCjkRecall);
    expect(report.leakedNoise).toEqual([]);
  });
});

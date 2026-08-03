import { describe, expect, it } from "vitest";
import {
  HISTORICAL_BASELINE_VERSION,
  ENTITY_EXTRACTION_BASELINE_EXPECTED,
  ENTITY_EXTRACTION_BASELINE_FALSE_POSITIVES,
  SYNONYM_RETRIEVAL_BASELINE_CASES,
  WATCHER_FAILURE_BASELINE_CASES,
  runHistoricalBaseline
} from "../src/evaluation/historical-baseline.js";

describe("historical capability baseline", () => {
  it("measures semantic, entity, context, and watch failure baselines without changing public eval query sets", async () => {
    const report = await runHistoricalBaseline();

    expect(report.baselineVersion).toBe(HISTORICAL_BASELINE_VERSION);
    expect(report.runtime).toEqual({
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch
    });
    expect(report.semantic.provider).toBe("local-hash");
    expect(report.semantic.cases).toHaveLength(SYNONYM_RETRIEVAL_BASELINE_CASES.length);
    expect(report.semantic.keywordRecallAt5).toBe(0);
    expect(report.semantic.localHashRecallAt5).toBe(0.5);
    expect(report.semantic.cases.map((item) => item.localHashRank)).toEqual([null, 1, 1, null]);

    expect(report.entities.expected).toHaveLength(ENTITY_EXTRACTION_BASELINE_EXPECTED.length);
    expect(report.entities.precision).toBe(0.5);
    expect(report.entities.recall).toBe(1);
    expect(new Set(report.entities.falsePositives)).toEqual(new Set(ENTITY_EXTRACTION_BASELINE_FALSE_POSITIVES));

    expect(report.context.packingStrategy).toBe("mmr-style-document-round-robin");
    expect(report.context.itemCount).toBe(5);
    expect(report.context.uniqueDocuments).toBe(3);
    expect(report.context.diversityRatio).toBe(0.6);
    expect(report.context.averagePairwiseJaccard).toBe(0.3808);
    expect(report.context.maximumPairwiseJaccard).toBe(0.8571);
    expect(report.context.nearDuplicatePairs).toBe(3);

    expect(report.watch.cases).toEqual(WATCHER_FAILURE_BASELINE_CASES);
    expect(report.watch.currentPolicy).toEqual({
      errorSignal: "onError_callback",
      persistentHealth: false,
      fatalRuntimeErrors: false,
      pollingFallback: false
    });
  });
});

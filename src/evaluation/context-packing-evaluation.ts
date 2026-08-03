import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { DEFAULT_CONFIG } from "../config/load-config.js";
import { openDatabase } from "../db/connection.js";
import { GraphRepository } from "../db/repositories.js";
import { indexProject } from "../indexer.js";
import { buildContext, type ContextDebug, type ContextPackingStrategy } from "../query/context-builder.js";
import type { MDGraphConfig } from "../types.js";

export const CONTEXT_PACKING_EVALUATION_VERSION = 1;
export const CONTEXT_PACKING_GATES = {
  minimumRedundancyReduction: 0.2,
  maximumDocumentRecallDrop: 0.02
} as const;

const EXPECTED_DOCUMENTS = [
  "docs/recovery-details.md",
  "docs/recovery-limits.md",
  "docs/recovery-operations.md"
] as const;

export interface ContextPackingMeasurement {
  packingStrategy: ContextPackingStrategy;
  itemCount: number;
  uniqueDocuments: number;
  expectedDocumentRecall: number;
  averagePairwiseJaccard: number;
  maximumPairwiseJaccard: number;
  nearDuplicatePairs: number;
  budgetFit: boolean;
  packingSimilarity?: ContextDebug["packingSimilarity"];
  redundancySkippedItems: number;
}

export interface ContextPackingEvaluationReport {
  evaluationVersion: typeof CONTEXT_PACKING_EVALUATION_VERSION;
  baseline: ContextPackingMeasurement;
  mmr: ContextPackingMeasurement;
  redundancyReduction: number;
  documentRecallDrop: number;
  gates: typeof CONTEXT_PACKING_GATES;
  passed: boolean;
  elapsedMs: number;
}

export async function runContextPackingEvaluation(): Promise<ContextPackingEvaluationReport> {
  const started = performance.now();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-context-packing-"));
  try {
    writeFixture(root);
    await indexProject(root, { full: true });

    const repository = new GraphRepository(openDatabase(root));
    try {
      const config: MDGraphConfig = {
        ...DEFAULT_CONFIG,
        search: { ...DEFAULT_CONFIG.search, defaultLimit: 12, maxContextChars: 50_000 }
      };
      const baseline = measure(repository, config, "mmr-style-document-round-robin");
      const mmr = measure(repository, config, "mmr");
      const redundancyReduction = baseline.averagePairwiseJaccard
        ? round((baseline.averagePairwiseJaccard - mmr.averagePairwiseJaccard) / baseline.averagePairwiseJaccard)
        : 0;
      const documentRecallDrop = round(Math.max(0, baseline.expectedDocumentRecall - mmr.expectedDocumentRecall));
      const passed = redundancyReduction >= CONTEXT_PACKING_GATES.minimumRedundancyReduction
        && documentRecallDrop <= CONTEXT_PACKING_GATES.maximumDocumentRecallDrop
        && mmr.budgetFit;
      return {
        evaluationVersion: CONTEXT_PACKING_EVALUATION_VERSION,
        baseline,
        mmr,
        redundancyReduction,
        documentRecallDrop,
        gates: CONTEXT_PACKING_GATES,
        passed,
        elapsedMs: Number((performance.now() - started).toFixed(2))
      };
    } finally {
      repository.close();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function measure(
  repository: GraphRepository,
  config: MDGraphConfig,
  packingStrategy: ContextPackingStrategy
): ContextPackingMeasurement {
  const context = buildContext(repository, config, "SessionRecoveryPolicy", {
    debug: true,
    searchLimit: 12,
    maxChars: 50_000,
    packingStrategy
  });
  const pairwise = pairwiseJaccard(context.items.map((item) => item.content));
  const observedDocuments = new Set(context.items.map((item) => item.path));
  return {
    packingStrategy,
    itemCount: context.items.length,
    uniqueDocuments: observedDocuments.size,
    expectedDocumentRecall: ratio(EXPECTED_DOCUMENTS.filter((document) => observedDocuments.has(document)).length, EXPECTED_DOCUMENTS.length),
    averagePairwiseJaccard: average(pairwise),
    maximumPairwiseJaccard: pairwise.length ? round(Math.max(...pairwise)) : 0,
    nearDuplicatePairs: pairwise.filter((value) => value >= 0.8).length,
    budgetFit: context.usedChars <= context.maxChars,
    packingSimilarity: context.debug?.packingSimilarity,
    redundancySkippedItems: context.debug?.redundancySkippedItems ?? 0
  };
}

function writeFixture(root: string): void {
  writeMarkdown(root, "docs/recovery-details.md", "Recovery Details", [
    "## First Attempt",
    "",
    "`SessionRecoveryPolicy` retries authentication sessions after cache failures and records recovery diagnostics.",
    "",
    "## Second Attempt",
    "",
    "`SessionRecoveryPolicy` retries authentication sessions after cache failures and records recovery diagnostics.",
    "",
    "## Third Attempt",
    "",
    "`SessionRecoveryPolicy` retries authentication sessions after cache failures and records recovery diagnostics."
  ].join("\n"));
  writeMarkdown(root, "docs/recovery-limits.md", "Recovery Limits", "`SessionRecoveryPolicy` caps retries before returning a terminal authentication response.");
  writeMarkdown(root, "docs/recovery-operations.md", "Recovery Operations", "`SessionRecoveryPolicy` routes exhausted attempts to operational diagnostics and an incident runbook.");
}

function writeMarkdown(root: string, relativePath: string, title: string, content: string): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `# ${title}\n\n${content}\n`, "utf8");
}

function pairwiseJaccard(contents: string[]): number[] {
  const tokenSets = contents.map(tokensForSimilarity);
  const similarities: number[] = [];
  for (let left = 0; left < tokenSets.length; left += 1) {
    for (let right = left + 1; right < tokenSets.length; right += 1) {
      similarities.push(jaccard(tokenSets[left], tokenSets[right]));
    }
  }
  return similarities;
}

function tokensForSimilarity(content: string): Set<string> {
  return new Set(content.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
}

function jaccard(left: Set<string>, right: Set<string>): number {
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }
  return ratio(intersection, new Set([...left, ...right]).size);
}

function average(values: number[]): number {
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function ratio(numerator: number, denominator: number): number {
  return denominator ? round(numerator / denominator) : 0;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { loadConfig } from "../config/load-config.js";
import { openDatabase } from "../db/connection.js";
import { GraphRepository } from "../db/repositories.js";
import { indexProject } from "../indexer.js";
import { deriveRelatedRelationships } from "../relationships/derive-related.js";
import { registerEmbeddingProvider } from "../semantic/provider-registry.js";

export const RELATED_DOCUMENTS_EVALUATION_VERSION = 1;
export const RELATED_DOCUMENTS_GATES = {
  minimumPrecision: 0.9,
  minimumRecall: 0.8,
  requireCompleteProvenance: true,
  requireDeterministicReplacement: true
} as const;

const EXPECTED_PAIRS = [
  ["docs/auth-decision.md", "docs/auth-runbook.md"],
  ["docs/cache-incident.md", "docs/cache-runbook.md"]
] as const;

export interface RelatedDocumentsEvaluationReport {
  evaluationVersion: typeof RELATED_DOCUMENTS_EVALUATION_VERSION;
  expectedPairs: string[];
  observedPairs: string[];
  truePositives: string[];
  falsePositives: string[];
  falseNegatives: string[];
  precision: number;
  recall: number;
  completeProvenance: boolean;
  deterministicReplacement: boolean;
  relationshipPairs: number;
  directedEdges: number;
  qualityGate: string;
  gates: typeof RELATED_DOCUMENTS_GATES;
  passed: boolean;
  elapsedMs: number;
}

export async function runRelatedDocumentsEvaluation(): Promise<RelatedDocumentsEvaluationReport> {
  const started = performance.now();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-related-relationships-"));
  const unregister = registerEmbeddingProvider("related-fixture-semantic", "semantic-model", (config) => ({
    id: config.provider,
    model: config.model,
    dimensions: config.dimensions,
    capability: "semantic-model",
    locality: "in-process",
    availability: async () => ({ status: "available" }),
    embedDocuments: async (inputs) => inputs.map(fixtureVector),
    embedQuery: async (input) => fixtureVector(input)
  }));
  try {
    writeFixture(root);
    await indexProject(root, { full: true });
    const repository = new GraphRepository(openDatabase(root));
    try {
      const config = loadConfig(root);
      const first = await deriveRelatedRelationships(repository, root, config, { threshold: 0.9 });
      const firstEdges = repository.allEdges()
        .filter((edge) => edge.kind === "RELATED_TO" && edge.provenance === "embedding_similarity")
        .map((edge) => edge.id)
        .sort();
      const second = await deriveRelatedRelationships(repository, root, config, { threshold: 0.9 });
      const secondEdges = repository.allEdges()
        .filter((edge) => edge.kind === "RELATED_TO" && edge.provenance === "embedding_similarity");
      const observedPairs = second.relationships.map((relationship) => pairKey(relationship.fromPath, relationship.toPath)).sort();
      const expectedPairs = EXPECTED_PAIRS.map(([left, right]) => pairKey(left, right)).sort();
      const expected = new Set(expectedPairs);
      const observed = new Set(observedPairs);
      const truePositives = observedPairs.filter((pair) => expected.has(pair));
      const falsePositives = observedPairs.filter((pair) => !expected.has(pair));
      const falseNegatives = expectedPairs.filter((pair) => !observed.has(pair));
      const precision = ratio(truePositives.length, observedPairs.length);
      const recall = ratio(truePositives.length, expectedPairs.length);
      const completeProvenance = secondEdges.length === second.directedEdges && secondEdges.every((edge) => {
        const metadata = edge.metadata ?? {};
        const evidence = Array.isArray(metadata.evidenceSections) ? metadata.evidenceSections : [];
        return metadata.provider === "related-fixture-semantic"
          && metadata.model === "related-fixture-model"
          && metadata.algorithmVersion === second.algorithmVersion
          && metadata.qualityGate === second.qualityGate.id
          && typeof metadata.threshold === "number"
          && typeof metadata.generatedAt === "string"
          && evidence.length >= 2;
      });
      const deterministicReplacement = firstEdges.length === secondEdges.length
        && firstEdges.every((id, index) => id === secondEdges.map((edge) => edge.id).sort()[index])
        && second.mutation.removed === first.directedEdges
        && second.mutation.inserted === second.directedEdges;
      const passed = precision >= RELATED_DOCUMENTS_GATES.minimumPrecision
        && recall >= RELATED_DOCUMENTS_GATES.minimumRecall
        && (!RELATED_DOCUMENTS_GATES.requireCompleteProvenance || completeProvenance)
        && (!RELATED_DOCUMENTS_GATES.requireDeterministicReplacement || deterministicReplacement);
      return {
        evaluationVersion: RELATED_DOCUMENTS_EVALUATION_VERSION,
        expectedPairs,
        observedPairs,
        truePositives,
        falsePositives,
        falseNegatives,
        precision,
        recall,
        completeProvenance,
        deterministicReplacement,
        relationshipPairs: second.relationshipPairs,
        directedEdges: second.directedEdges,
        qualityGate: second.qualityGate.id,
        gates: RELATED_DOCUMENTS_GATES,
        passed,
        elapsedMs: elapsed(started)
      };
    } finally {
      repository.close();
    }
  } finally {
    unregister();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeFixture(root: string): void {
  fs.mkdirSync(path.join(root, ".mdgraph"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, ".mdgraph", "config.json"), `${JSON.stringify({
    docs: { include: ["docs/**/*.md"] },
    embedding: {
      enabled: true,
      provider: "related-fixture-semantic",
      model: "related-fixture-model",
      dimensions: 4,
      batchSize: 4
    }
  }, null, 2)}\n`, "utf8");
  writeDocument(root, "auth-decision.md", "Auth Decision", "AUTH_CLUSTER", "AUTH_CLUSTER");
  writeDocument(root, "auth-runbook.md", "Login Recovery", "AUTH_CLUSTER", "AUTH_CLUSTER");
  writeDocument(root, "cache-incident.md", "Cache Incident", "CACHE_CLUSTER", "CACHE_CLUSTER");
  writeDocument(root, "cache-runbook.md", "Cache Recovery", "CACHE_CLUSTER", "CACHE_CLUSTER");
  writeDocument(root, "billing-guide.md", "Billing Guide", "BILLING_CLUSTER", "BILLING_CLUSTER");
  writeDocument(root, "mixed-note.md", "Mixed Note", "AUTH_CLUSTER", "BILLING_CLUSTER");
}

function writeDocument(root: string, file: string, title: string, first: string, second: string): void {
  fs.writeFileSync(path.join(root, "docs", file), `---
title: ${title}
type: guide
status: active
---
## First evidence

${first}

## Second evidence

${second}
`, "utf8");
}

function fixtureVector(input: string): number[] {
  if (input.includes("AUTH_CLUSTER") && input.includes("BILLING_CLUSTER")) {
    return [1, 0, 1, 0];
  }
  if (input.includes("AUTH_CLUSTER")) {
    return [1, 0, 0, 0];
  }
  if (input.includes("CACHE_CLUSTER")) {
    return [0, 1, 0, 0];
  }
  if (input.includes("BILLING_CLUSTER")) {
    return [0, 0, 1, 0];
  }
  return [0, 0, 0, 1];
}

function pairKey(left: string, right: string): string {
  return [left, right].sort().join(" <-> ");
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function elapsed(started: number): number {
  return Number((performance.now() - started).toFixed(2));
}

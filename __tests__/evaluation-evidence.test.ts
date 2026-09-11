import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { indexProject } from "../src/indexer.js";
import { openDatabase } from "../src/db/connection.js";
import { GraphRepository } from "../src/db/repositories.js";
import { loadConfig } from "../src/config/load-config.js";
import { evaluateRetrieval, evaluateRetrievalAsync } from "../src/evaluation/retrieval-eval.js";

it("distinguishes indexed evidence from evidence returned by this query", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-evaluation-evidence-"));
  fs.writeFileSync(path.join(root, "policy.md"), "---\ndefines: [HiddenPolicy]\nsource_refs: [src/policy.ts]\n---\n# Policy\nOperational instructions.\n");
  await indexProject(root);
  const repository = new GraphRepository(openDatabase(root));
  const config = loadConfig(root);
  const expected = { id: "evidence", expectedDocuments: ["policy.md"], expectedSections: [], expectedEntities: ["HiddenPolicy"], expectedSourceRefs: ["src/policy.ts"], expectedEdges: ["DEFINES", "REFERENCES_SOURCE"] as const };
  try {
    const missed = evaluateRetrieval(repository, config, { cases: [{ ...expected, expectedEdges: [...expected.expectedEdges], query: "zzmissingzz" }] }).cases[0];
    expect(missed.metrics).toMatchObject({ entityRecall: 1, sourceRefRecall: 1, edgeKindCoverage: 1, retrievedEntityRecall: 0, retrievedSourceRefRecall: 0, retrievedEdgeKindCoverage: 0 });
    expect(missed.retrievalEvidencePassed).toBe(false);
    const noise = evaluateRetrieval(repository, config, { cases: [{ ...expected, expectedDocuments: ["unreturned.md"], expectedEdges: [...expected.expectedEdges], query: "Operational" }] }).cases[0];
    expect(noise.metrics.contextIrrelevantRatio).toBe(1);
    for (const evaluate of [evaluateRetrieval, evaluateRetrievalAsync]) {
      const hit = (await evaluate(repository, config, { cases: [{ ...expected, expectedEdges: [...expected.expectedEdges], query: "HiddenPolicy" }] })).cases[0];
      expect(hit.metrics).toMatchObject({ retrievedEntityRecall: 1, retrievedSourceRefRecall: 1, retrievedEdgeKindCoverage: 1, contextIrrelevantRatio: 0 });
      expect(hit.retrievalEvidencePassed).toBe(true);
    }
  } finally { repository.close(); }
});

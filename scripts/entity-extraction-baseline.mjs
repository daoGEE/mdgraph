import { ENTITY_EXTRACTION_GATES, runEntityExtractionEvaluation } from "../dist/evaluation/entity-extraction-evaluation.js";

const report = runEntityExtractionEvaluation();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (
  report.precision < ENTITY_EXTRACTION_GATES.minimumPrecision ||
  report.recall < ENTITY_EXTRACTION_GATES.minimumRecall ||
  report.cjkRecall < ENTITY_EXTRACTION_GATES.minimumCjkRecall ||
  report.leakedNoise.length > 0
) {
  process.exitCode = 1;
}

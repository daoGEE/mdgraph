import { CONTEXT_PACKING_GATES, runContextPackingEvaluation } from "../dist/evaluation/context-packing-evaluation.js";

const report = await runContextPackingEvaluation();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (
  report.redundancyReduction < CONTEXT_PACKING_GATES.minimumRedundancyReduction ||
  report.documentRecallDrop > CONTEXT_PACKING_GATES.maximumDocumentRecallDrop ||
  !report.mmr.budgetFit
) {
  process.exitCode = 1;
}

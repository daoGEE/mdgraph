import {
  RELATED_DOCUMENTS_GATES,
  runRelatedDocumentsEvaluation
} from "../dist/evaluation/related-documents-evaluation.js";

const report = await runRelatedDocumentsEvaluation();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (
  report.precision < RELATED_DOCUMENTS_GATES.minimumPrecision
  || report.recall < RELATED_DOCUMENTS_GATES.minimumRecall
  || (RELATED_DOCUMENTS_GATES.requireCompleteProvenance && !report.completeProvenance)
  || (RELATED_DOCUMENTS_GATES.requireDeterministicReplacement && !report.deterministicReplacement)
) {
  process.exitCode = 1;
}

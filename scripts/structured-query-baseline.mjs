import {
  STRUCTURED_QUERY_GATES,
  runStructuredQueryEvaluation
} from "../dist/evaluation/structured-query-evaluation.js";

const report = await runStructuredQueryEvaluation();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (
  report.caseAccuracy < STRUCTURED_QUERY_GATES.minimumCaseAccuracy ||
  (STRUCTURED_QUERY_GATES.requireParameterizedExecution && !report.parameterizedExecution) ||
  (STRUCTURED_QUERY_GATES.requireInjectionIsolation && !report.injectionIsolation)
) {
  process.exitCode = 1;
}

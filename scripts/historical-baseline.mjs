import { runHistoricalBaseline } from "../dist/evaluation/historical-baseline.js";

const report = await runHistoricalBaseline();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

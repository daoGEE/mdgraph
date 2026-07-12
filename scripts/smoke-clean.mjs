import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-clean-smoke-"));

try {
  const tracked = run("git", ["ls-files", "-z"], { cwd: repoRoot }).stdout
    .split("\0")
    .filter(Boolean);

  for (const relativePath of tracked) {
    if (relativePath === "dist" || relativePath.startsWith("dist/") || relativePath === ".mdgraph" || relativePath.startsWith(".mdgraph/")) {
      continue;
    }
    const source = path.join(repoRoot, relativePath);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      continue;
    }
    const target = path.join(tempRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }

  if (fs.existsSync(path.join(tempRoot, "dist"))) {
    throw new Error("Clean smoke snapshot unexpectedly contains dist before npm test.");
  }

  const sourceModules = path.join(repoRoot, "node_modules");
  const targetModules = path.join(tempRoot, "node_modules");
  fs.symlinkSync(sourceModules, targetModules, process.platform === "win32" ? "junction" : undefined);

  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error("npm_execpath is not set; run this smoke through npm run smoke:clean.");
  }
  run(process.execPath, [npmCli, "test"], { cwd: tempRoot });

  const builtCli = path.join(tempRoot, "dist", "bin", "mdgraph.js");
  if (!fs.existsSync(builtCli)) {
    throw new Error(`npm test did not build the CLI in a clean snapshot: ${builtCli}`);
  }
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error([
      `Command failed: ${command} ${args.join(" ")}`,
      `cwd: ${options.cwd}`,
      `exit: ${result.status}`,
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`
    ].join("\n"));
  }
  return result;
}

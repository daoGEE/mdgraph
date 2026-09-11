import fs from "node:fs";
import path from "node:path";
import { normalizePath } from "./text.js";

export function isPathInsideOrEqual(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative === "" || Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveInsideRoot(root: string, target: string): string | undefined {
  const resolved = path.resolve(root, target);
  return isPathInsideOrEqual(root, resolved) ? resolved : undefined;
}

export function assertInsideRoot(root: string, target: string, label = "path"): string {
  const resolved = path.resolve(target);
  if (!isPathInsideOrEqual(root, resolved)) {
    throw new Error(`${label} must stay inside project root: ${target}`);
  }
  return resolved;
}

export function relativePathInsideRoot(root: string, target: string): string | undefined {
  if (!isPathInsideOrEqual(root, target)) {
    return undefined;
  }
  return normalizePath(path.relative(path.resolve(root), path.resolve(target)));
}

/** Resolve existing ancestors as well as the final target, including storage not created yet. */
export function realPathForAccess(target: string): string {
  const absolute = path.resolve(target);
  try {
    return fs.realpathSync(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // A dangling link is not an absent path and must not be treated as safe to create.
    if (fs.lstatSync(absolute, { throwIfNoEntry: false })?.isSymbolicLink()) throw error;
    const parent = path.dirname(absolute);
    if (parent === absolute) throw error;
    return path.join(realPathForAccess(parent), path.basename(absolute));
  }
}

export function assertProjectFilesInsideRoot(root: string, project: string): void {
  const actualRoot = fs.realpathSync(root);
  for (const target of [project, ...[".gitignore", ".mdgraph", ".mdgraph/config.json", ".mdgraph/graph.db", ".mdgraph/graph.db-wal", ".mdgraph/graph.db-shm", ".mdgraph/graph.db-journal"].map((entry) => path.join(project, entry))]) {
    if (!isPathInsideOrEqual(actualRoot, realPathForAccess(target))) {
      throw new Error(`Project files must stay inside served project root: ${root}. Start a separate MDGraph server with --path set to the intended external project.`);
    }
  }
}

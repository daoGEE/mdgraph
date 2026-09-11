import fs from "node:fs";
import path from "node:path";
import type { GraphRepository } from "../db/repositories.js";
import { scanMarkdownFilesSync } from "../scanner/file-scanner.js";
import type { MDGraphConfig } from "../types.js";
import { contentHash } from "../utils/id.js";
import { normalizePath } from "../utils/text.js";

export interface StatusFreshness {
  state: "fresh" | "stale" | "unknown";
  lastIndexedAt?: string;
  recommendation: string;
  checkedAt?: string;
  issues?: Array<{ path: string; reason: "added" | "deleted" | "modified" }>;
}

export interface StatusFreshnessOptions {
  /** Compare Markdown bytes with the indexed document hashes. This detects edits
   * whose mtime was intentionally preserved; the default remains the cheap mtime check. */
  strictContentHash?: boolean;
  /** Project-relative Markdown paths outside the source snapshot being evaluated. */
  ignorePaths?: string[];
}

export function computeStatusFreshness(
  projectRoot: string,
  config: MDGraphConfig,
  repository: GraphRepository,
  options: StatusFreshnessOptions = {}
): StatusFreshness {
  const lastIndexedAt = repository.latestIndexedAt();
  const checkedAt = new Date().toISOString();
  if (!lastIndexedAt) {
    return {
      state: "unknown",
      checkedAt,
      recommendation: "no indexed timestamp is available; run `mdgraph index` before relying on the graph"
    };
  }

  try {
    const indexedAtMs = Date.parse(lastIndexedAt);
    const scanned = scanMarkdownFilesSync(projectRoot, config);
    const indexed = repository.documentHashes();
    const ignored = new Set((options.ignorePaths ?? []).map(normalizePath));
    const isIgnored = (relativePath: string) => [...ignored].some((ignoredPath) => relativePath === ignoredPath || relativePath.startsWith(`${ignoredPath}/`));
    const scannedByPath = new Map(scanned
      .map((filePath) => [normalizePath(path.relative(projectRoot, filePath)), filePath] as const)
      .filter(([relativePath]) => !isIgnored(relativePath)));
    const issues: NonNullable<StatusFreshness["issues"]> = [];

    for (const [relativePath, absolutePath] of scannedByPath) {
      if (!indexed.has(relativePath)) {
        issues.push({ path: relativePath, reason: "added" });
        continue;
      }
      const changed = options.strictContentHash
        ? contentHash(fs.readFileSync(absolutePath, "utf8")) !== indexed.get(relativePath)!.hash
        : Number.isFinite(indexedAtMs) && fs.statSync(absolutePath).mtimeMs > indexedAtMs + 1;
      if (changed) {
        issues.push({ path: relativePath, reason: "modified" });
      }
    }

    for (const documentPath of indexed.keys()) {
      if (!isIgnored(documentPath) && !scannedByPath.has(documentPath)) {
        issues.push({ path: documentPath, reason: "deleted" });
      }
    }

    const sortedIssues = issues.sort((left, right) => left.path.localeCompare(right.path) || left.reason.localeCompare(right.reason));
    return {
      state: sortedIssues.length ? "stale" : "fresh",
      lastIndexedAt,
      checkedAt,
      recommendation: sortedIssues.length
        ? "Markdown files changed since indexing; run `mdgraph index` before relying on results"
        : options.strictContentHash
          ? "indexed Markdown files match the strict content-hash freshness check"
          : "indexed Markdown files match the lightweight status freshness check",
      // Strict callers make policy decisions from this list (for example, which
      // Wiki pages depend on a changed document), so never truncate their evidence.
      // Existing lightweight status callers retain the bounded public payload.
      issues: sortedIssues.length ? (options.strictContentHash ? sortedIssues : sortedIssues.slice(0, 20)) : undefined
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      state: "unknown",
      lastIndexedAt,
      checkedAt,
      recommendation: `freshness check failed: ${message}; run \`mdgraph doctor --json\` or \`mdgraph index\``
    };
  }
}

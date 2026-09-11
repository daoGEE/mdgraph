import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { computeStatusFreshness, type StatusFreshness } from "../analysis/status-freshness.js";
import { hashCanonical } from "../bundle/bundle.js";
import { loadConfig } from "../config/load-config.js";
import type { GraphRepository } from "../db/repositories.js";
import { isPathInsideOrEqual, resolveInsideRoot } from "../utils/path-safety.js";
import { normalizePath } from "../utils/text.js";

export interface WikiEvidencePage {
  id: string;
  title: string;
  path: string;
  parentId?: string;
  purpose: string;
  audience: string;
  outline: string[];
  documentIds: string[];
  sourceRefs: string[];
  evidenceQueries: string[];
}

export interface WikiContentFreshnessOptions {
  wikiDir?: string;
}

export interface WikiPageEvidenceStatus {
  currentEvidenceHash: string;
  staleDocumentPaths: string[];
}

/** Returns the strict on-disk Markdown evidence used by Wiki plan, brief, and status. */
export function wikiContentFreshness(
  projectRoot: string,
  repository: GraphRepository,
  options: WikiContentFreshnessOptions = {}
): StatusFreshness {
  const wikiRelativePath = options.wikiDir && isPathInsideOrEqual(projectRoot, options.wikiDir)
    ? normalizePath(path.relative(projectRoot, options.wikiDir))
    : undefined;
  return computeStatusFreshness(projectRoot, loadConfig(projectRoot), repository, {
    strictContentHash: true,
    ignorePaths: wikiRelativePath && wikiRelativePath !== "." ? [wikiRelativePath] : undefined
  });
}

export function calculateWikiPageEvidenceHash(
  projectRoot: string,
  repository: GraphRepository,
  page: WikiEvidencePage
): string {
  const documentsById = new Map(repository.allDocuments().map((document) => [document.id, document]));
  const documents = page.documentIds.map((documentId) => {
    const document = documentsById.get(documentId);
    return document
      ? { id: document.id, path: document.path, hash: document.hash }
      : { id: documentId, missing: true };
  });
  const sourceRefs = page.sourceRefs.map((sourceRef) => ({
    path: sourceRef,
    fingerprint: sourceRefFingerprint(projectRoot, sourceRef)
  }));
  return hashCanonical({
    page: {
      id: page.id,
      title: page.title,
      path: page.path,
      parentId: page.parentId,
      purpose: page.purpose,
      audience: page.audience,
      outline: page.outline,
      documentIds: page.documentIds,
      sourceRefs: page.sourceRefs,
      evidenceQueries: page.evidenceQueries
    },
    documents,
    sourceRefs
  });
}

export function wikiPageEvidenceStatus(
  projectRoot: string,
  repository: GraphRepository,
  page: WikiEvidencePage,
  freshness: StatusFreshness
): WikiPageEvidenceStatus {
  const documentsById = new Map(repository.allDocuments().map((document) => [document.id, document.path]));
  const stalePaths = new Set(freshness.issues
    ?.filter((issue) => issue.reason === "modified" || issue.reason === "deleted")
    .map((issue) => issue.path) ?? []);
  return {
    currentEvidenceHash: calculateWikiPageEvidenceHash(projectRoot, repository, page),
    staleDocumentPaths: page.documentIds.flatMap((documentId) => {
      const documentPath = documentsById.get(documentId);
      return documentPath && stalePaths.has(documentPath) ? [documentPath] : [];
    })
  };
}

export function sourceRefFingerprint(projectRoot: string, sourceRef: string): string {
  const normalized = safeProjectRelativePath(sourceRef);
  if (!normalized) return "unsafe";
  try {
    const resolved = resolveInsideRoot(projectRoot, normalized);
    if (!resolved || !fs.existsSync(resolved)) return "missing";
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink()) {
      let realPath: string;
      try {
        realPath = fs.realpathSync(resolved);
      } catch {
        return "broken-symlink";
      }
      if (!isPathInsideOrEqual(projectRoot, realPath)) return "unsafe-symlink";
    }
    if (!stat.isFile() && !stat.isSymbolicLink()) return "not-file";
    return hashFile(resolved);
  } catch {
    return "unreadable";
  }
}

export function safeProjectRelativePath(value: string): string | undefined {
  const normalized = normalizePath(value.trim()).replace(/^\.\//, "");
  const segments = normalized.split("/");
  return !normalized || normalized.includes("\0") || path.isAbsolute(normalized) || path.posix.isAbsolute(normalized) || /^[a-z]:\//i.test(normalized) || segments.some((segment) => !segment || segment === "." || segment === "..")
    ? undefined
    : normalized;
}

function hashFile(filePath: string): string {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const descriptor = fs.openSync(filePath, "r");
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

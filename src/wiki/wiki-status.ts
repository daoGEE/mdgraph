import fs from "node:fs";
import path from "node:path";
import { GraphRepository } from "../db/repositories.js";
import { buildGraphJsonExport } from "../export/graphjson.js";
import { type StatusFreshness } from "../analysis/status-freshness.js";
import { parseFrontmatterBlock } from "../parser/frontmatter.js";
import { parseMarkdownDocument } from "../parser/markdown-parser.js";
import { isPathInsideOrEqual, resolveInsideRoot } from "../utils/path-safety.js";
import { normalizePath, slugifyHeading, uniqueStrings } from "../utils/text.js";
import {
  WIKI_PLAN_FORMAT_VERSION,
  WikiPlanError,
  safeProjectRelativePath,
  safeWikiPagePath,
  wikiSourceHash,
  type WikiPlan,
  type WikiPlanPage
} from "./wiki-plan.js";
import { sourceRefFingerprint, wikiContentFreshness } from "./wiki-evidence.js";

import { assessWikiDependencies, type WikiDependencyChange, type WikiDependencyAssessment } from "./wiki-dependencies.js";

export const WIKI_STATUS_FORMAT = "mdgraph-wiki-status" as const;
export const WIKI_STATUS_FORMAT_VERSION = 1 as const;
export const WIKI_VERIFICATION_FORMAT = "mdgraph-wiki-verification" as const;
export const WIKI_VERIFICATION_FORMAT_VERSION = 1 as const;
const MAX_WIKI_MARKDOWN_FILES = 10_000;
const MAX_WIKI_DIRECTORY_DEPTH = 32;
const MAX_WIKI_PAGE_BYTES = 2 * 1024 * 1024;

export type WikiPageState = "current" | "needs_update" | "missing" | "orphaned";

export interface WikiPageStatus {
  id: string;
  path: string;
  state: WikiPageState;
  changes?: WikiDependencyChange[];
  selectionChanges?: Array<{ field: "source_docs" | "source_refs"; added: string[]; missing: string[] }>;
  evidenceState?: WikiDependencyAssessment["state"];
  reason?: string;
  recovery?: string;
}

export interface WikiPlanStatus {
  state: "current" | "stale";
  graphHash: string;
  sourceHash: string;
  currentGraphHash: string;
  currentSourceHash: string;
  reason?: string;
  recovery?: string;
  /** Strict document content evidence used for Wiki maintenance decisions. */
  indexFreshness?: StatusFreshness;
}

export interface WikiStatus {
  format: typeof WIKI_STATUS_FORMAT;
  formatVersion: typeof WIKI_STATUS_FORMAT_VERSION;
  wikiDir: string;
  plan: WikiPlanStatus;
  pages: WikiPageStatus[];
  summary: Record<WikiPageState, number>;
}

export interface WikiVerificationIssue {
  code: string;
  message: string;
  pageId?: string;
  path?: string;
  evidence?: string;
  recovery: string;
}

export interface WikiVerification {
  format: typeof WIKI_VERIFICATION_FORMAT;
  formatVersion: typeof WIKI_VERIFICATION_FORMAT_VERSION;
  valid: boolean;
  scope: "maintenance-and-evidence";
  contentReview: "not-evaluated";
  errors: WikiVerificationIssue[];
  warnings: WikiVerificationIssue[];
  status: WikiStatus;
}

export interface WikiStatusOptions {
  planPath?: string;
}

interface WikiPageFile {
  path: string;
  absolutePath: string;
  raw: string;
  frontmatter: Record<string, unknown>;
  frontmatterError?: string;
}

export function buildWikiStatus(
  projectRoot: string,
  repository: GraphRepository,
  wikiDir: string,
  plan: WikiPlan,
  options: WikiStatusOptions = {}
): WikiStatus {
  const resolvedWikiDir = path.resolve(wikiDir);
  assertWikiDirectoryReadable(resolvedWikiDir);
  const currentGraph = buildGraphJsonExport(projectRoot, repository);
  const planCommand = wikiPlanRecoveryCommand(options.planPath);
  const indexFreshness = wikiContentFreshness(projectRoot, repository, { wikiDir: resolvedWikiDir });
  const currentSourceHash = plan.formatVersion === 2 ? wikiSourceHash(repository, plan.wikiDir) : currentGraph.sourceHash;
  const planCurrent = (plan.formatVersion === 2 || plan.graphHash === currentGraph.graphHash)
    && plan.sourceHash === currentSourceHash
    && indexFreshness.state === "fresh";
  const planStatus: WikiPlanStatus = {
    state: planCurrent ? "current" : "stale",
    graphHash: plan.graphHash,
    sourceHash: plan.sourceHash,
    currentGraphHash: currentGraph.graphHash,
    currentSourceHash,
    reason: planCurrent ? undefined : indexFreshness.state !== "fresh"
      ? `Indexed Markdown evidence is ${indexFreshness.state}; ${indexFreshness.recommendation}.`
      : "The graph or indexed document source snapshot has changed since this plan was created.",
    recovery: planCurrent ? undefined : indexFreshness.state !== "fresh"
      ? "Run `mdgraph index`, then regenerate the Wiki plan before relying on this status."
      : planCommand,
    indexFreshness
  };
  const documentsById = new Map(repository.allDocuments().map((document) => [document.id, document]));
  const pageStatuses = plan.pages.map((page) => {
    const evidence = assessWikiDependencies(projectRoot, repository, page, indexFreshness, plan.wikiDir ?? normalizePath(path.relative(projectRoot, resolvedWikiDir)));
    return {
      ...statusForPlannedPage(projectRoot, repository, resolvedWikiDir, page, documentsById, planCommand, evidence),
      changes: evidence.changes,
      selectionChanges: wikiSelectionChanges(resolvedWikiDir, page, documentsById),
      evidenceState: evidence.state
    };
  });
  const plannedPaths = new Set(plan.pages.map((page) => page.path));
  const orphaned = scanWikiMarkdownFiles(resolvedWikiDir)
    .filter((pagePath) => !plannedPaths.has(pagePath))
    .flatMap((pagePath): WikiPageStatus[] => {
      const pageFile = readWikiPageFile(resolvedWikiDir, pagePath);
      const wikiId = optionalFrontmatterString(pageFile.frontmatter.wiki_id);
      if (!wikiId) {
        return [];
      }
      return [{
        id: wikiId,
        path: pagePath,
        state: "orphaned",
        reason: plan.pages.some((page) => page.id === wikiId)
          ? `The page uses planned wiki_id ${wikiId}, but its path is not ${plan.pages.find((page) => page.id === wikiId)?.path}.`
          : `The page declares wiki_id ${wikiId}, which is not present in the plan.`,
        recovery: `Review ${pagePath}; move it to the planned path, remove its wiki_id, or regenerate the plan before deleting user content.`
      }];
    });
  const pages = [...pageStatuses, ...orphaned.sort(comparePageStatus)];
  const summary: Record<WikiPageState, number> = {
    current: 0,
    needs_update: 0,
    missing: 0,
    orphaned: 0
  };
  for (const page of pages) {
    summary[page.state] += 1;
  }
  return {
    format: WIKI_STATUS_FORMAT,
    formatVersion: WIKI_STATUS_FORMAT_VERSION,
    wikiDir: normalizePath(wikiDir),
    plan: planStatus,
    pages,
    summary
  };
}

export function verifyWiki(
  projectRoot: string,
  repository: GraphRepository,
  wikiDir: string,
  plan: WikiPlan,
  options: WikiStatusOptions = {}
): WikiVerification {
  const status = buildWikiStatus(projectRoot, repository, wikiDir, plan, options);
  const resolvedWikiDir = path.resolve(wikiDir);
  const errors: WikiVerificationIssue[] = [];
  const warnings: WikiVerificationIssue[] = [];
  if (plan.formatVersion !== 1 && plan.formatVersion !== WIKI_PLAN_FORMAT_VERSION) {
    errors.push(issue(
      "wiki.plan_version",
      `Unsupported Wiki plan formatVersion: ${plan.formatVersion}.`,
      "Regenerate the plan with the current MDGraph CLI."
    ));
  }
  if (status.plan.state === "stale") {
    warnings.push(issue(
      "wiki.plan_stale",
      status.plan.reason ?? "The Wiki plan is stale.",
      status.plan.recovery ?? wikiPlanRecoveryCommand(options.planPath)
    ));
  }
  const strictFreshness = status.plan.indexFreshness;
  if (strictFreshness && strictFreshness.state !== "fresh") {
    errors.push(issue(
      "wiki.index_stale",
      `Indexed Markdown evidence is ${strictFreshness.state}; ${strictFreshness.recommendation}.`,
      "Run `mdgraph index`, regenerate the Wiki plan, then update the affected Wiki pages."
    ));
  }
  for (const pageStatus of status.pages) {
    if (pageStatus.state === "current") {
      continue;
    }
    errors.push(issue(
      `wiki.page_${pageStatus.state}`,
      pageStatus.reason ?? `Wiki page ${pageStatus.id} is ${pageStatus.state}.`,
      pageStatus.recovery ?? "Run `mdgraph wiki status` and repair this page.",
      pageStatus.id,
      pageStatus.path
    ));
  }

  const indexedPaths = new Set(repository.allDocuments().map((document) => document.path));
  for (const page of plan.pages) {
    const absolutePath = path.resolve(resolvedWikiDir, page.path);
    if (!fs.existsSync(absolutePath) || !fs.lstatSync(absolutePath).isFile()) {
      continue;
    }
    const pageFile = readWikiPageFile(resolvedWikiDir, page.path);
    if (pageFile.frontmatterError) {
      errors.push(issue(
        "wiki.frontmatter_invalid",
        pageFile.frontmatterError,
        `Repair YAML front matter in ${page.path}.`,
        page.id,
        page.path
      ));
      continue;
    }
    const sourceDocs = frontmatterStringArray(pageFile.frontmatter.source_docs);
    const sourceRefs = frontmatterStringArray(pageFile.frontmatter.source_refs);
    verifyFrontmatterPathArray(page, "source_docs", pageFile.frontmatter.source_docs, errors);
    verifyFrontmatterPathArray(page, "source_refs", pageFile.frontmatter.source_refs, errors);
    verifySourceDocuments(projectRoot, page, sourceDocs, indexedPaths, errors);
    verifySourceRefs(projectRoot, page, sourceRefs, errors);
    verifyRelativeLinks(resolvedWikiDir, page, errors);
  }
  return {
    format: WIKI_VERIFICATION_FORMAT,
    formatVersion: WIKI_VERIFICATION_FORMAT_VERSION,
    valid: errors.length === 0,
    scope: "maintenance-and-evidence",
    contentReview: "not-evaluated",
    errors,
    warnings,
    status
  };
}

export function formatWikiStatus(status: WikiStatus): string {
  const lines = [
    `Wiki status: ${status.summary.current} current, ${status.summary.needs_update} needs update, ${status.summary.missing} missing, ${status.summary.orphaned} orphaned`,
    "Current means recorded dependencies and maintenance fields match; prose correctness is not evaluated.",
    `Plan: ${status.plan.state}`,
    `Evidence freshness: ${status.plan.indexFreshness?.state ?? "unknown"}`
  ];
  for (const page of status.pages) {
    lines.push(`- ${page.id} [${page.state}] ${page.path}`);
    for (const change of page.changes ?? []) lines.push(`  Changed ${change.kind}: ${change.path} (${change.reason})`);
    for (const selection of page.selectionChanges ?? []) lines.push(`  Review ${selection.field}: added ${selection.added.join(", ") || "none"}; missing ${selection.missing.join(", ") || "none"}`);
    if (page.reason) {
      lines.push(`  Reason: ${page.reason}`);
    }
    if (page.recovery) {
      lines.push(`  Recovery: ${page.recovery}`);
    }
  }
  if (status.plan.recovery) {
    lines.push(`Plan recovery: ${status.plan.recovery}`);
  }
  if (status.plan.indexFreshness?.state !== "fresh") {
    lines.push(`Evidence recovery: ${status.plan.indexFreshness?.recommendation ?? "Run \`mdgraph index\`, then regenerate the Wiki plan."}`);
  }
  return lines.join("\n");
}

export function formatWikiVerification(verification: WikiVerification): string {
  const lines = [
    "Scope: maintenance fields, links, and evidence. Prose correctness is not evaluated.",
    `Wiki verification: ${verification.valid ? "valid" : "invalid"}`,
    `Errors: ${verification.errors.length}; warnings: ${verification.warnings.length}`
  ];
  for (const error of verification.errors) {
    lines.push(`- ERROR ${error.code}: ${error.message}`);
    lines.push(`  Recovery: ${error.recovery}`);
  }
  for (const warning of verification.warnings) {
    lines.push(`- WARNING ${warning.code}: ${warning.message}`);
    lines.push(`  Recovery: ${warning.recovery}`);
  }
  return lines.join("\n");
}

function wikiSelectionChanges(wikiDir: string, page: WikiPlanPage, documents: Map<string, { path: string }>): NonNullable<WikiPageStatus["selectionChanges"]> {
  const absolutePath = path.resolve(wikiDir, page.path);
  if (!fs.existsSync(absolutePath) || !fs.lstatSync(absolutePath).isFile()) return [];
  const file = readWikiPageFile(wikiDir, page.path);
  const expectedDocs = page.documentIds.flatMap((id) => documents.get(id) ? [documents.get(id)!.path] : []);
  return (["source_docs", "source_refs"] as const).flatMap((field) => {
    if (!isFrontmatterPathArray(file.frontmatter[field])) return [];
    const actual = frontmatterStringArray(file.frontmatter[field]);
    const expected = field === "source_docs" ? expectedDocs : page.sourceRefs;
    const added = actual.filter((value) => !expected.includes(value));
    const missing = expected.filter((value) => !actual.includes(value));
    return added.length || missing.length ? [{ field, added, missing }] : [];
  });
}

function statusForPlannedPage(
  projectRoot: string,
  repository: GraphRepository,
  wikiDir: string,
  page: WikiPlanPage,
  documentsById: Map<string, { path: string }>,
  planCommand: string,
  evidence: WikiDependencyAssessment
): WikiPageStatus {
  const absolutePath = path.resolve(wikiDir, page.path);
  if (!isPathInsideOrEqual(wikiDir, absolutePath)) {
    return pageProblem(page, "needs_update", "The planned page path escapes the Wiki directory.", planCommand);
  }
  if (!fs.existsSync(absolutePath)) {
    return pageProblem(page, "missing", "The plan requires this page, but the file does not exist.", `Create ${page.path} from mdgraph wiki brief ${page.id} and preserve its maintenance front matter.`);
  }
  const stat = fs.lstatSync(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return pageProblem(page, "needs_update", "The planned page must be a regular Markdown file, not a directory or symbolic link.", `Replace ${page.path} with a regular Markdown file after preserving any user content.`);
  }
  const pageFile = readWikiPageFile(wikiDir, page.path);
  if (pageFile.frontmatterError) {
    return pageProblem(page, "needs_update", pageFile.frontmatterError, `Repair YAML front matter in ${page.path}.`);
  }
  const wikiId = optionalFrontmatterString(pageFile.frontmatter.wiki_id);
  if (wikiId !== page.id) {
    return pageProblem(page, "needs_update", `Expected wiki_id ${page.id}, found ${wikiId ?? "none"}.`, `Set wiki_id to ${page.id} in ${page.path}.`);
  }
  if (evidence.state !== "fresh") {
    const change = evidence.changes[0];
    return pageProblem(page, "needs_update", change
      ? `${change.kind} dependency ${change.path}: ${change.reason}.`
      : "Cannot establish whether the page dependencies are current.", evidence.recovery ?? planCommand);
  }
  const evidenceHash = optionalFrontmatterString(pageFile.frontmatter.evidence_hash);
  if (evidenceHash !== page.evidenceHash) {
    return pageProblem(page, "needs_update", `Expected evidence_hash ${page.evidenceHash}, found ${evidenceHash ?? "none"}.`, `Use mdgraph wiki brief ${page.id}, update the page, then set evidence_hash to ${page.evidenceHash}.`);
  }
  const expectedSourceDocs = page.documentIds.flatMap((documentId) => {
    const document = documentsById.get(documentId);
    return document ? [document.path] : [];
  });
  const sourceDocs = frontmatterStringArray(pageFile.frontmatter.source_docs);
  if (!isFrontmatterPathArray(pageFile.frontmatter.source_docs)) {
    return pageProblem(page, "needs_update", "source_docs must be a non-empty-string array; scalar, empty, and mixed values are not valid evidence.", `Replace source_docs in ${page.path} with the project-relative paths from the current page brief.`);
  }
  if (!sameStrings(sourceDocs, expectedSourceDocs)) {
    return pageProblem(page, "needs_update", "source_docs does not match the plan evidence documents.", `Review source_docs in ${page.path}; add intended sources to the plan documentIds, refresh the plan and brief, then synchronize fields. Preserve user-selected sources until reviewed.`);
  }
  const sourceRefs = frontmatterStringArray(pageFile.frontmatter.source_refs);
  if (!isFrontmatterPathArray(pageFile.frontmatter.source_refs)) {
    return pageProblem(page, "needs_update", "source_refs must be a non-empty-string array; scalar, empty, and mixed values are not valid evidence.", `Replace source_refs in ${page.path} with the project-relative paths from the current page brief.`);
  }
  if (!sameStrings(sourceRefs, page.sourceRefs)) {
    return pageProblem(page, "needs_update", "source_refs does not match the plan evidence source refs.", `Review source_refs in ${page.path}; add intended sources to the plan sourceRefs, refresh the plan and brief, then synchronize fields. Preserve user-selected sources until reviewed.`);
  }
  return { id: page.id, path: page.path, state: "current" };
}

function readWikiPageFile(wikiDir: string, pagePath: string): WikiPageFile {
  const safePath = safeWikiPagePath(pagePath);
  if (!safePath) {
    throw new WikiPlanError("wiki.page_path", `Unsafe Wiki page path: ${pagePath}`, "Regenerate the Wiki plan.");
  }
  const absolutePath = path.resolve(wikiDir, safePath);
  if (!isPathInsideOrEqual(wikiDir, absolutePath)) {
    throw new WikiPlanError("wiki.page_path", `Wiki page path escapes the Wiki directory: ${pagePath}`, "Regenerate the Wiki plan.");
  }
  const size = fs.statSync(absolutePath).size;
  if (size > MAX_WIKI_PAGE_BYTES) {
    return {
      path: safePath,
      absolutePath,
      raw: "",
      frontmatter: {},
      frontmatterError: `Wiki page exceeds ${MAX_WIKI_PAGE_BYTES} bytes: ${safePath}.`
    };
  }
  const raw = fs.readFileSync(absolutePath, "utf8");
  const parsed = parseFrontmatterBlock(raw);
  const fatalDiagnostic = parsed.diagnostics.find((diagnostic) => diagnostic.code !== "front_matter.invalid_field");
  return {
    path: safePath,
    absolutePath,
    raw,
    frontmatter: parsed.data,
    frontmatterError: fatalDiagnostic ? `${fatalDiagnostic.message} (line ${fatalDiagnostic.line})` : undefined
  };
}

function verifySourceDocuments(
  projectRoot: string,
  page: WikiPlanPage,
  sourceDocs: string[],
  indexedPaths: Set<string>,
  errors: WikiVerificationIssue[]
): void {
  for (const sourceDoc of sourceDocs) {
    const safe = safeProjectRelativePath(sourceDoc);
    if (!safe || !resolveInsideRoot(projectRoot, safe)) {
      errors.push(issue("wiki.source_doc_unsafe", `Unsafe source_docs path: ${sourceDoc}.`, `Use an indexed project-relative Markdown path in ${page.path}.`, page.id, page.path, sourceDoc));
    } else if (!indexedPaths.has(safe)) {
      errors.push(issue("wiki.source_doc_unindexed", `source_docs path is not a currently indexed document: ${safe}.`, "Reindex the project, correct source_docs, or regenerate the plan.", page.id, page.path, safe));
    }
  }
}

function verifySourceRefs(
  projectRoot: string,
  page: WikiPlanPage,
  sourceRefs: string[],
  errors: WikiVerificationIssue[]
): void {
  for (const sourceRef of sourceRefs) {
    const safe = safeProjectRelativePath(sourceRef);
    if (!safe) {
      errors.push(issue("wiki.source_ref_unsafe", `Unsafe source_refs path: ${sourceRef}.`, `Use a project-relative path in ${page.path}.`, page.id, page.path, sourceRef));
      continue;
    }
    const fingerprint = sourceRefFingerprint(projectRoot, safe);
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
      errors.push(issue("wiki.source_ref_missing", `source_refs path is not a safe existing file: ${safe} (${fingerprint}).`, "Restore the source path, correct source_refs, or regenerate the plan.", page.id, page.path, safe));
    }
  }
}

function verifyRelativeLinks(wikiDir: string, page: WikiPlanPage, errors: WikiVerificationIssue[]): void {
  let parsed;
  try {
    parsed = parseMarkdownDocument(wikiDir, path.resolve(wikiDir, page.path));
  } catch (error) {
    errors.push(issue("wiki.page_parse", `Cannot parse ${page.path}: ${error instanceof Error ? error.message : String(error)}`, `Repair Markdown in ${page.path}.`, page.id, page.path));
    return;
  }
  for (const link of parsed.markdownLinks) {
    const result = resolveWikiLink(wikiDir, page.path, link.url);
    if (result.state === "external") {
      continue;
    }
    if (result.state === "invalid") {
      errors.push(issue("wiki.link_unresolved", `Unresolved relative link in ${page.path}:${link.line}: ${link.url}.`, `Correct the link target or add the missing Wiki page.`, page.id, page.path, link.url));
      continue;
    }
    if (result.anchor && result.target.toLowerCase().endsWith(".md")) {
      try {
        const target = parseMarkdownDocument(wikiDir, path.resolve(wikiDir, result.target));
        const anchors = new Set(target.sections.map((section) => section.anchor));
        if (!anchors.has(slugifyHeading(result.anchor))) {
          errors.push(issue("wiki.link_anchor", `Missing anchor #${result.anchor} in ${result.target}.`, `Correct the anchor referenced from ${page.path}:${link.line}.`, page.id, page.path, link.url));
        }
      } catch (error) {
        errors.push(issue("wiki.link_target_parse", `Cannot parse link target ${result.target}: ${error instanceof Error ? error.message : String(error)}`, `Repair ${result.target}.`, page.id, page.path, link.url));
      }
    }
  }
}

function resolveWikiLink(
  wikiDir: string,
  fromPath: string,
  rawUrl: string
): { state: "external" } | { state: "invalid" } | { state: "resolved"; target: string; anchor?: string } {
  if (/^[a-z][a-z0-9+.-]*:/i.test(rawUrl) || rawUrl.startsWith("//")) {
    return { state: "external" };
  }
  let decoded: string;
  try {
    decoded = decodeURI(rawUrl);
  } catch {
    return { state: "invalid" };
  }
  const [targetWithQuery, rawAnchor] = decoded.split("#", 2);
  const rawTarget = targetWithQuery.split("?", 1)[0];
  if (rawTarget.startsWith("/")) {
    return { state: "invalid" };
  }
  const relativeTarget = rawTarget || path.posix.basename(fromPath);
  const combined = normalizePath(path.posix.join(path.posix.dirname(fromPath), relativeTarget));
  const safe = safeProjectRelativePath(combined);
  if (!safe) {
    return { state: "invalid" };
  }
  const candidates = linkTargetCandidates(wikiDir, safe);
  const target = candidates.find((candidate) => {
    const absolute = path.resolve(wikiDir, candidate);
    return isPathInsideOrEqual(wikiDir, absolute) && fs.existsSync(absolute) && fs.lstatSync(absolute).isFile();
  });
  return target ? { state: "resolved", target, anchor: rawAnchor || undefined } : { state: "invalid" };
}

function linkTargetCandidates(wikiDir: string, target: string): string[] {
  const absolute = path.resolve(wikiDir, target);
  const candidates = [target];
  if (!path.posix.extname(target)) {
    candidates.push(`${target}.md`, path.posix.join(target, "index.md"));
  }
  if (fs.existsSync(absolute) && fs.lstatSync(absolute).isDirectory()) {
    candidates.push(path.posix.join(target, "index.md"));
  }
  return uniqueStrings(candidates);
}

function scanWikiMarkdownFiles(wikiDir: string): string[] {
  if (!fs.existsSync(wikiDir)) {
    return [];
  }
  const files: string[] = [];
  const queue: Array<{ absolutePath: string; relativePath: string; depth: number }> = [{ absolutePath: wikiDir, relativePath: "", depth: 0 }];
  while (queue.length) {
    const current = queue.shift()!;
    if (current.depth > MAX_WIKI_DIRECTORY_DEPTH) {
      throw new WikiPlanError("wiki.directory_depth", `Wiki directory exceeds depth ${MAX_WIKI_DIRECTORY_DEPTH}.`, "Narrow the Wiki directory or remove recursive directory cycles.");
    }
    const entries = fs.readdirSync(current.absolutePath, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const relativePath = normalizePath(path.posix.join(current.relativePath, entry.name));
      const absolutePath = path.join(current.absolutePath, entry.name);
      if (entry.isDirectory()) {
        queue.push({ absolutePath, relativePath, depth: current.depth + 1 });
      } else if (entry.isFile() && relativePath.toLowerCase().endsWith(".md")) {
        files.push(relativePath);
        if (files.length > MAX_WIKI_MARKDOWN_FILES) {
          throw new WikiPlanError("wiki.directory_files", `Wiki directory exceeds ${MAX_WIKI_MARKDOWN_FILES} Markdown files.`, "Narrow the Wiki directory or split verification into smaller maintained Wiki roots.");
        }
      }
    }
  }
  return files.sort();
}

function assertWikiDirectoryReadable(wikiDir: string): void {
  if (!fs.existsSync(wikiDir)) {
    return;
  }
  if (!fs.lstatSync(wikiDir).isDirectory()) {
    throw new WikiPlanError("wiki.directory", `Wiki target is not a directory: ${wikiDir}`, "Pass the directory that contains the planned Wiki pages.");
  }
}

function frontmatterStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => typeof item === "string" && item.trim() ? [normalizePath(item.trim())] : []);
}

function isFrontmatterPathArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function verifyFrontmatterPathArray(
  page: WikiPlanPage,
  field: "source_docs" | "source_refs",
  value: unknown,
  errors: WikiVerificationIssue[]
): void {
  if (isFrontmatterPathArray(value)) {
    return;
  }
  const actual = value === undefined ? "missing" : Array.isArray(value) ? "contains an empty or non-string item" : "is a scalar or non-array value";
  errors.push(issue(
    `wiki.${field}_invalid`,
    `${field} in ${page.path} ${actual}; it must be an array of non-empty project-relative paths.`,
    `Replace ${field} in ${page.path} with the project-relative paths from \`mdgraph wiki brief ${page.id}\`.`,
    page.id,
    page.path
  ));
}

function optionalFrontmatterString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sameStrings(left: string[], right: string[]): boolean {
  const normalizedLeft = uniqueStrings(left).sort();
  const normalizedRight = uniqueStrings(right).sort();
  return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function pageProblem(page: WikiPlanPage, state: Exclude<WikiPageState, "current" | "orphaned">, reason: string, recovery: string): WikiPageStatus {
  return { id: page.id, path: page.path, state, reason, recovery };
}

function issue(
  code: string,
  message: string,
  recovery: string,
  pageId?: string,
  issuePath?: string,
  evidence?: string
): WikiVerificationIssue {
  return { code, message, pageId, path: issuePath, evidence, recovery };
}

function comparePageStatus(left: WikiPageStatus, right: WikiPageStatus): number {
  return left.path.localeCompare(right.path) || left.id.localeCompare(right.id);
}

function wikiPlanRecoveryCommand(planPath: string | undefined): string {
  return `mdgraph wiki plan --out ${planPath ? JSON.stringify(planPath) : "<plan-file>"}`;
}

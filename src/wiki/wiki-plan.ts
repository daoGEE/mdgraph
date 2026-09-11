import fs from "node:fs";
import path from "node:path";
import { hashCanonical } from "../bundle/bundle.js";
import { GraphRepository } from "../db/repositories.js";
import { type StatusFreshness } from "../analysis/status-freshness.js";
import { buildGraphJsonExport } from "../export/graphjson.js";
import {
  buildContext,
  type ContextItem
} from "../query/context-builder.js";
import {
  createKnowledgeCardBuilder,
  type KnowledgeCard
} from "../query/knowledge-card.js";
import type { GraphDocument, MDGraphConfig, SourceRef } from "../types.js";
import { readBoundedJsonFile } from "../utils/bounded-json.js";
import { normalizePath, uniqueStrings } from "../utils/text.js";
import {
  calculateWikiPageEvidenceHash,
  safeProjectRelativePath,
  sourceRefFingerprint,
  wikiContentFreshness,
  type WikiEvidencePage
} from "./wiki-evidence.js";
import { WIKI_DOMAINS as DOMAIN_TEMPLATES, type WikiDomain } from "./wiki-domains.js";

import { assessWikiDependencies, type WikiDependencyAssessment } from "./wiki-dependencies.js";

export { calculateWikiPageEvidenceHash, safeProjectRelativePath, sourceRefFingerprint } from "./wiki-evidence.js";

export const WIKI_PLAN_FORMAT = "mdgraph-wiki-plan" as const;
export const WIKI_PLAN_FORMAT_VERSION = 2 as const;
export const WIKI_PAGE_BRIEF_FORMAT = "mdgraph-wiki-page-brief" as const;
export const WIKI_PAGE_BRIEF_FORMAT_VERSION = 1 as const;
const MAX_DOMAIN_SEEDS = 8;
const MAX_PAGE_DOCUMENTS = 12;
const MAX_BRIEF_CARDS = 8;

export interface WikiPlan {
  format: typeof WIKI_PLAN_FORMAT;
  formatVersion: 1 | typeof WIKI_PLAN_FORMAT_VERSION;
  graphHash: string;
  sourceHash: string;
  /** v2 records the project-relative generated Wiki root. */
  wikiDir?: string;
  /** Additive strict Markdown content evidence for deciding whether to use this plan. */
  strictFreshness?: WikiStrictFreshness;
  pages: WikiPlanPage[];
  suggestions?: WikiPlanSuggestions;
  gaps?: WikiPlanGap[];
}

export interface WikiPlanSuggestions {
  pages: WikiPlanPage[];
  sources: Array<{ pageId: string; documentIds: string[]; sourceRefs: string[] }>;
}

export interface WikiPlanGap { kind: "document" | "source_ref" | "domain"; path?: string; reason: string; recovery: string; }

export interface WikiPlanOptions {
  from?: WikiPlan;
  wikiDir?: string;
}

export interface WikiStrictFreshness {
  state: StatusFreshness["state"];
  recommendation: string;
  issues?: NonNullable<StatusFreshness["issues"]>;
}

export interface WikiPlanPage {
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
  evidenceHash: string;
  dependencySnapshot?: WikiDependencySnapshot;
  gaps?: WikiPlanGap[];
}

export interface WikiDependencySnapshot {
  documents: Array<{ id: string; path?: string; hash?: string; missing?: true }>;
  sourceRefs: Array<{ path: string; fingerprint: string }>;
}

export interface WikiPageBrief {
  format: typeof WIKI_PAGE_BRIEF_FORMAT;
  formatVersion: typeof WIKI_PAGE_BRIEF_FORMAT_VERSION;
  page: WikiPlanPage;
  maxChars: number;
  usedChars: number;
  sourceDocuments: WikiBriefSourceDocument[];
  supplementaryDocuments: WikiBriefSourceDocument[];
  sourceInspections: Array<{ path: string; instruction: string }>;
  evidenceGaps: WikiPlanGap[];
  dependencyEvidence: WikiDependencyAssessment;
  contextItems: ContextItem[];
  knowledgeCards: KnowledgeCard[];
  writingRequirements: string[];
  suggestedNextQueries: string[];
  /** Strict Markdown content evidence available when the brief was prepared. */
  strictFreshness: WikiStrictFreshness;
}

export interface WikiBriefSourceDocument {
  id: string;
  path: string;
  title: string;
  type: GraphDocument["type"];
  status: string;
  trustTier: GraphDocument["trustTier"];
}

export interface WikiBriefOptions {
  maxChars?: number;
}

export class WikiPlanError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly recovery: string
  ) {
    super(`${message} Recovery: ${recovery}`);
    this.name = "WikiPlanError";
  }
}

interface WikiPageSeed extends Omit<WikiPlanPage, "evidenceHash">, WikiEvidencePage {}

export function buildWikiPlan(projectRoot: string, repository: GraphRepository, options: WikiPlanOptions = {}): WikiPlan {
  const graph = buildGraphJsonExport(projectRoot, repository);
  const wikiDir = resolveWikiDir(projectRoot, options.wikiDir ?? options.from?.wikiDir ?? "wiki");
  if (options.from?.formatVersion === 1 && !options.wikiDir) {
    throw new WikiPlanError("wiki.plan_wiki_dir", "A v1 plan does not record wikiDir.", "Pass --wiki-dir <project-relative-directory> when updating this plan.");
  }
  const strictFreshness = wikiStrictFreshness(projectRoot, repository, wikiDir);
  const documents = repository.allDocuments().filter((document) => !isUnderWikiDir(document.path, wikiDir));
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const relatedDocuments = relatedDocumentIdsByDocument(repository);
  const sourceRefsByDocument = sourceRefsByDocumentId(repository);
  const selectedByDomain = DOMAIN_TEMPLATES.map((domain) => ({
    domain,
    documents: expandDomainDocuments(rankedDomainDocuments(domain, documents), documentsById, relatedDocuments)
  }));
  if (documents.length && !selectedByDomain[0].documents.length) {
    selectedByDomain[0].documents = [documents.slice().sort(compareDocuments)[0]];
  }
  const hasOverview = selectedByDomain[0].documents.length > 0;
  const suggestedPages: WikiPlanSuggestions["pages"] = [];
  const suggestedSources: WikiPlanSuggestions["sources"] = [];
  const generated = selectedByDomain
    .filter((entry) => entry.documents.length > 0)
    .map(({ domain, documents: domainDocuments }): WikiPlanPage => {
      const documentIds = domainDocuments.map((document) => document.id);
      const sourceRefs = uniqueStrings(domainDocuments.flatMap((document) => sourceRefsByDocument.get(document.id) ?? [])).sort();
      const seed: WikiPageSeed = {
        id: domain.id,
        title: domain.title,
        path: domain.path,
        parentId: domain.id !== "project-overview" && hasOverview ? "project-overview" : undefined,
        purpose: domain.purpose,
        audience: domain.audience,
        outline: uniqueStrings([...domain.outline, ...domainDocuments.slice(0, 2).map((document) => document.title)]),
        documentIds,
        sourceRefs,
        evidenceQueries: uniqueStrings([...domain.evidenceQueries, ...domainDocuments.slice(0, 2).map((document) => document.title)])
      };
      return {
        ...seed,
        evidenceHash: calculateWikiPageEvidenceHash(projectRoot, repository, seed),
        dependencySnapshot: dependencySnapshot(projectRoot, repository, seed),
        gaps: pageGaps(projectRoot, repository, seed, wikiDir)
      };
    });
  const pages = options.from ? mergePlanPages(projectRoot, repository, options.from, generated, suggestedPages, suggestedSources, wikiDir) : generated;
  return {
    format: WIKI_PLAN_FORMAT,
    formatVersion: WIKI_PLAN_FORMAT_VERSION,
    graphHash: graph.graphHash,
    sourceHash: wikiSourceHash(repository, wikiDir),
    wikiDir,
    strictFreshness,
    pages,
    suggestions: { pages: suggestedPages, sources: suggestedSources },
    gaps: [...pages.flatMap((page) => page.gaps ?? []), ...selectedByDomain.filter((entry) => !entry.documents.length).map(({ domain }): WikiPlanGap => ({ kind: "domain", reason: `No indexed evidence supports the ${domain.title} candidate.`, recovery: "Add relevant project documentation and refresh the plan when this page is needed." }))]
  };
}

export function buildWikiPageBrief(
  projectRoot: string,
  repository: GraphRepository,
  config: MDGraphConfig,
  plan: WikiPlan,
  pageId: string,
  options: WikiBriefOptions = {}
): WikiPageBrief {
  const page = plan.pages.find((candidate) => candidate.id === pageId);
  if (!page) {
    throw new WikiPlanError(
      "wiki.page_not_found",
      `Wiki page is not present in the plan: ${pageId}`,
      "Run `mdgraph wiki plan` again or choose a page ID listed in the current plan."
    );
  }
  const maxChars = positiveIntegerOr(options.maxChars, config.search.maxContextChars);
  const documentsById = new Map(repository.allDocuments().map((document) => [document.id, document]));
  const wikiDir = plan.wikiDir ?? "wiki";
  const plannedDocuments = page.documentIds.flatMap((documentId) => {
    const document = documentsById.get(documentId);
    return document && !isUnderWikiDir(document.path, wikiDir) ? [document] : [];
  });
  const knownFiles = uniqueStrings([
    ...plannedDocuments.map((document) => document.path),
    ...page.sourceRefs
  ]);
  const contextBudget = Math.max(1, Math.floor(maxChars * 0.65));
  const query = [page.title, page.purpose, ...page.evidenceQueries].join(" ");
  const context = buildContext(repository, config, query, {
    knownFiles,
    maxChars: contextBudget,
    searchLimit: Math.max(config.search.defaultLimit * 2, 16),
    maxDepth: config.search.maxDepth
  });
  const contextItems = context.items.filter((item) => !isUnderWikiDir(item.path, wikiDir));
  const builder = createKnowledgeCardBuilder(repository);
  const wikiDocumentIds = new Set(repository.allDocuments().filter((document) => isUnderWikiDir(document.path, wikiDir)).map((document) => document.id));
  const cardNodeIds = uniqueStrings([
    ...page.documentIds,
    ...contextItems.map((item) => item.nodeId)
  ]).filter((nodeId) => !wikiDocumentIds.has(nodeId));
  const knowledgeCards: KnowledgeCard[] = [];
  let usedChars = contextItems.reduce((sum, item) => sum + item.content.length + (item.cardSummary?.length ?? 0), 0);
  for (const nodeId of cardNodeIds) {
    if (knowledgeCards.length >= MAX_BRIEF_CARDS) {
      break;
    }
    const card = builder.build(nodeId);
    if (!card) {
      continue;
    }
    const cardChars = JSON.stringify(card).length;
    if (usedChars + cardChars > maxChars) {
      continue;
    }
    knowledgeCards.push(card);
    usedChars += cardChars;
  }
  const strictFreshness = wikiStrictFreshness(projectRoot, repository, wikiDir);
  const dependencyEvidence = assessWikiDependencies(projectRoot, repository, page, strictFreshness, wikiDir);
  const evidenceGaps = pageGaps(projectRoot, repository, page, wikiDir);
  const plannedPaths = new Set(plannedDocuments.map((document) => document.path));
  const supplementaryPaths = new Set(contextItems.filter((item) => !plannedPaths.has(item.path)).map((item) => item.path));
  const supplementaryDocuments = [...documentsById.values()].filter((document) => supplementaryPaths.has(document.path));
  const writingRequirements = [
    `Write for this audience: ${page.audience}`,
    `Make the page achieve this purpose: ${page.purpose}`,
    "Use the outline as guidance, not as text to copy mechanically.",
    "Read the listed source documents and inspect listed source refs before making behavioral claims.",
    "Distinguish directly evidenced behavior from conclusions that still require source verification.",
    "Keep project-relative source_docs and source_refs in front matter, and preserve wiki_id and evidence_hash.",
    "Do not overwrite or rewrite unrelated Wiki pages.",
    strictFreshness.state === "fresh" && dependencyEvidence.state === "fresh" && !evidenceGaps.length
      ? `Set evidence_hash to ${page.evidenceHash}.`
      : `Index evidence: ${strictFreshness.state}; page dependencies: ${dependencyEvidence.state}. ${dependencyEvidence.recovery ?? "Run mdgraph index, review missing sources, and refresh the plan before finalizing this page."} Do not set evidence_hash from this unresolved evidence.`
  ];
  const suggestedNextQueries = uniqueStrings([
    ...page.evidenceQueries.map((evidenceQuery) => `mdgraph context ${JSON.stringify(evidenceQuery)}`),
    ...plannedDocuments.slice(0, 4).map((document) => `mdgraph node ${JSON.stringify(document.path)}`),
    ...(context.suggestedNextQueries ?? [])
  ]);
  return {
    format: WIKI_PAGE_BRIEF_FORMAT,
    formatVersion: WIKI_PAGE_BRIEF_FORMAT_VERSION,
    page,
    maxChars,
    usedChars,
    sourceDocuments: plannedDocuments.map((document) => ({
      id: document.id,
      path: document.path,
      title: document.title,
      type: document.type,
      status: document.status,
      trustTier: document.trustTier
    })),
    supplementaryDocuments: supplementaryDocuments.map((document) => ({ id: document.id, path: document.path, title: document.title, type: document.type, status: document.status, trustTier: document.trustTier })),
    sourceInspections: page.sourceRefs.map((source) => ({ path: source, instruction: "Inspect this selected project file before making implementation claims; a reference alone does not prove behavior." })),
    evidenceGaps,
    dependencyEvidence,
    contextItems,
    knowledgeCards,
    writingRequirements,
    suggestedNextQueries,
    strictFreshness
  };
}

export function stableWikiPlan(plan: WikiPlan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

function wikiStrictFreshness(projectRoot: string, repository: GraphRepository, wikiDir: string): WikiStrictFreshness {
  const freshness = wikiContentFreshness(projectRoot, repository, { wikiDir: path.resolve(projectRoot, wikiDir) });
  return {
    state: freshness.state,
    recommendation: freshness.recommendation,
    issues: freshness.issues
  };
}

export function formatWikiPlan(plan: WikiPlan): string {
  const lines = [
    `Wiki plan: ${plan.pages.length} page(s)`,
    `Format: v${plan.formatVersion}; Wiki directory: ${plan.wikiDir ?? "not recorded (v1)"}`,
    `Evidence freshness: ${plan.strictFreshness?.state ?? "unknown"}`,
    `Evidence guidance: ${plan.strictFreshness?.recommendation ?? "Refresh the index and plan before accepting its evidence."}`,
    `Graph hash: ${plan.graphHash}`,
    `Source hash: ${plan.sourceHash}`
  ];
  for (const page of plan.pages) {
    lines.push(`- ${page.id}: ${page.path} (${page.documentIds.length} document(s), ${page.sourceRefs.length} source ref(s))`);
  }
  for (const page of plan.suggestions?.pages ?? []) lines.push(`Suggested page: ${page.id} (${page.title}) -> ${page.path}`);
  for (const source of plan.suggestions?.sources ?? []) lines.push(`Suggested evidence for ${source.pageId}: documents ${source.documentIds.join(", ") || "none"}; sources ${source.sourceRefs.join(", ") || "none"}`);
  for (const gap of plan.gaps ?? []) lines.push(`Gap: ${gap.path ?? gap.kind}: ${gap.reason} Recovery: ${gap.recovery}`);
  return lines.join("\n");
}

export function formatWikiPageBrief(brief: WikiPageBrief): string {
  const lines = [
    `Wiki page brief: ${brief.page.id} (${brief.page.path})`,
    `Purpose: ${brief.page.purpose}`,
    `Audience: ${brief.page.audience}`,
    `Budget: ${brief.usedChars}/${brief.maxChars} chars`,
    `Source documents: ${brief.sourceDocuments.map((document) => document.path).join(", ") || "none"}`,
    `Context items: ${brief.contextItems.length}; Knowledge Cards: ${brief.knowledgeCards.length}`,
    `Evidence freshness: ${brief.strictFreshness.state}; page dependencies: ${brief.dependencyEvidence.state}`,
    `Supplementary documents: ${brief.supplementaryDocuments.map((document) => document.path).join(", ") || "none"}`,
    ...brief.sourceInspections.map((source) => `Inspect source: ${source.path}. ${source.instruction}`),
    ...brief.evidenceGaps.map((gap) => `Evidence gap: ${gap.path ?? gap.kind}: ${gap.reason} Recovery: ${gap.recovery}`),
    ...brief.dependencyEvidence.changes.map((change) => `Dependency change: ${change.path}: ${change.reason}`),
    "Writing requirements:",
    ...brief.writingRequirements.map((requirement) => `- ${requirement}`),
    "Suggested next queries:",
    ...brief.suggestedNextQueries.map((query) => `- ${query}`)
  ];
  return lines.join("\n");
}

export function writeWikiPlan(filePath: string, plan: WikiPlan): void {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = path.join(path.dirname(resolved), `.${path.basename(resolved)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(temporary, stableWikiPlan(plan), "utf8");
    fs.renameSync(temporary, resolved);
  } finally {
    if (fs.existsSync(temporary)) {
      fs.rmSync(temporary);
    }
  }
}

export function readWikiPlan(filePath: string): WikiPlan {
  let value: unknown;
  try {
    value = readBoundedJsonFile(path.resolve(filePath), "Wiki plan");
  } catch (error) {
    throw new WikiPlanError(
      "wiki.plan_unreadable",
      `Cannot read Wiki plan: ${error instanceof Error ? error.message : String(error)}`,
      "Run `mdgraph wiki plan --out <plan-file>` to create a readable plan."
    );
  }
  return validateWikiPlan(value);
}

export function validateWikiPlan(value: unknown): WikiPlan {
  if (!isRecord(value)) {
    throw invalidPlan("wiki.plan_shape", "Wiki plan must be a JSON object.");
  }
  if (value.format !== WIKI_PLAN_FORMAT) {
    throw invalidPlan("wiki.plan_format", `Unsupported Wiki plan format: ${String(value.format)}.`);
  }
  if (value.formatVersion !== 1 && value.formatVersion !== WIKI_PLAN_FORMAT_VERSION) {
    throw invalidPlan("wiki.plan_version", `Unsupported Wiki plan formatVersion: ${String(value.formatVersion)}.`);
  }
  if (!isSha256(value.graphHash) || !isSha256(value.sourceHash)) {
    throw invalidPlan("wiki.plan_hash", "Wiki plan graphHash and sourceHash must be SHA-256 strings.");
  }
  if (!Array.isArray(value.pages)) {
    throw invalidPlan("wiki.plan_pages", "Wiki plan pages must be an array.");
  }
  const pages = value.pages.map((page, index) => validateWikiPlanPage(page, index));
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const page of pages) {
    if (ids.has(page.id)) {
      throw invalidPlan("wiki.plan_duplicate_id", `Duplicate Wiki page ID: ${page.id}.`);
    }
    if (paths.has(page.path.toLowerCase())) {
      throw invalidPlan("wiki.plan_duplicate_path", `Duplicate Wiki page path: ${page.path}.`);
    }
    ids.add(page.id);
    paths.add(page.path.toLowerCase());
  }
  assertNoParentCycles(pages);
  for (const page of pages) {
    if (page.parentId && (!ids.has(page.parentId) || page.parentId === page.id)) {
      throw invalidPlan("wiki.plan_parent", `Invalid parentId for Wiki page ${page.id}: ${page.parentId}.`);
    }
  }
  const formatVersion = value.formatVersion as 1 | typeof WIKI_PLAN_FORMAT_VERSION;
  if (formatVersion === 2 && pages.some((page) => !page.dependencySnapshot)) {
    throw invalidPlan("wiki.plan_snapshot", "Every v2 page must contain its dependencySnapshot; refresh this plan from its previous version.");
  }
  const wikiDir = formatVersion === 2 ? safeProjectRelativePath(requiredString(value.wikiDir, "wikiDir")) : undefined;
  if (formatVersion === 2 && !wikiDir) {
    throw invalidPlan("wiki.plan_wiki_dir", "wikiDir must be a safe project-relative directory.");
  }
  return {
    format: WIKI_PLAN_FORMAT,
    formatVersion,
    graphHash: value.graphHash,
    sourceHash: value.sourceHash,
    strictFreshness: optionalWikiStrictFreshness(value.strictFreshness),
    wikiDir,
    pages,
    suggestions: formatVersion === 2 ? validateSuggestions(value.suggestions) : undefined,
    gaps: validateGaps(value.gaps)
  };
}

function assertNoParentCycles(pages: WikiPlanPage[]): void {
  const parentById = new Map(pages.map((page) => [page.id, page.parentId]));
  for (const page of pages) {
    const seen = new Set<string>();
    let current: string | undefined = page.id;
    while (current) {
      if (seen.has(current)) throw invalidPlan("wiki.plan_parent_cycle", `Wiki page parent cycle includes ${current}.`);
      seen.add(current);
      current = parentById.get(current);
    }
  }
}

function optionalWikiStrictFreshness(value: unknown): WikiStrictFreshness | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || (value.state !== "fresh" && value.state !== "stale" && value.state !== "unknown") || typeof value.recommendation !== "string") {
    throw invalidPlan("wiki.plan_strict_freshness", "Wiki plan strictFreshness must contain a freshness state and recommendation.");
  }
  if (value.issues !== undefined && (!Array.isArray(value.issues) || value.issues.some((issue) => !isRecord(issue) || typeof issue.path !== "string" || (issue.reason !== "added" && issue.reason !== "deleted" && issue.reason !== "modified")))) {
    throw invalidPlan("wiki.plan_strict_freshness", "Wiki plan strictFreshness issues must contain path and reason values.");
  }
  return {
    state: value.state,
    recommendation: value.recommendation,
    issues: value.issues as WikiStrictFreshness["issues"]
  };
}

export function safeWikiPagePath(value: string): string | undefined {
  const normalized = safeProjectRelativePath(value);
  return normalized && normalized.toLowerCase().endsWith(".md") ? normalized : undefined;
}

function rankedDomainDocuments(domain: WikiDomain, documents: GraphDocument[]): GraphDocument[] {
  return documents
    .map((document) => ({ document, score: domain.score(document) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || compareDocuments(left.document, right.document))
    .slice(0, MAX_DOMAIN_SEEDS)
    .map((entry) => entry.document);
}

function expandDomainDocuments(
  seeds: GraphDocument[],
  documentsById: Map<string, GraphDocument>,
  relatedDocuments: Map<string, string[]>
): GraphDocument[] {
  const selected = new Map(seeds.map((document) => [document.id, document]));
  const neighbors = uniqueStrings(seeds.flatMap((document) => relatedDocuments.get(document.id) ?? []))
    .flatMap((documentId) => {
      const document = documentsById.get(documentId);
      return document ? [document] : [];
    })
    .sort(compareDocuments);
  for (const document of neighbors) {
    if (selected.size >= MAX_PAGE_DOCUMENTS) {
      break;
    }
    selected.set(document.id, document);
  }
  return [...selected.values()];
}

function relatedDocumentIdsByDocument(repository: GraphRepository): Map<string, string[]> {
  const documents = repository.allDocuments();
  const documentIds = new Set(documents.map((document) => document.id));
  const documentBySection = new Map(repository.allSections().map((section) => [section.id, section.documentId]));
  const related = new Map(documents.map((document) => [document.id, [] as string[]]));
  const owningDocumentId = (nodeId: string): string | undefined => documentIds.has(nodeId) ? nodeId : documentBySection.get(nodeId);
  for (const edge of repository.allEdges()) {
    if (edge.kind === "CONTAINS") {
      continue;
    }
    const fromDocumentId = owningDocumentId(edge.fromId);
    const toDocumentId = owningDocumentId(edge.toId);
    if (!fromDocumentId || !toDocumentId || fromDocumentId === toDocumentId) {
      continue;
    }
    related.set(fromDocumentId, [...(related.get(fromDocumentId) ?? []), toDocumentId]);
    related.set(toDocumentId, [...(related.get(toDocumentId) ?? []), fromDocumentId]);
  }
  for (const [documentId, ids] of related) {
    related.set(documentId, uniqueStrings(ids).sort());
  }
  return related;
}

function sourceRefsByDocumentId(repository: GraphRepository): Map<string, string[]> {
  const documents = repository.allDocuments();
  const sections = repository.allSections();
  const sourceRefs = new Map(repository.allSourceRefs().map((sourceRef) => [sourceRef.id, sourceRef]));
  const documentBySection = new Map(sections.map((section) => [section.id, section.documentId]));
  const refs = new Map(documents.map((document) => [document.id, [] as string[]]));
  for (const edge of repository.allEdges()) {
    if (edge.kind !== "IMPLEMENTS" && edge.kind !== "REFERENCES_SOURCE") {
      continue;
    }
    const sourceRef: SourceRef | undefined = sourceRefs.get(edge.fromId) ?? sourceRefs.get(edge.toId);
    if (!sourceRef) {
      continue;
    }
    const ownerId = sourceRefs.has(edge.fromId) ? edge.toId : edge.fromId;
    const documentId = refs.has(ownerId) ? ownerId : documentBySection.get(ownerId);
    if (documentId) {
      refs.set(documentId, [...(refs.get(documentId) ?? []), sourceRef.path]);
    }
  }
  for (const [documentId, paths] of refs) {
    refs.set(documentId, uniqueStrings(paths).sort());
  }
  return refs;
}

export function wikiSourceHash(repository: GraphRepository, wikiDir = "wiki"): string {
  const normalizedWikiDir = safeProjectRelativePath(wikiDir) ?? "wiki";
  return hashCanonical(repository.allDocuments()
    .filter((document) => !isUnderWikiDir(document.path, normalizedWikiDir))
    .map((document) => ({ id: document.id, path: document.path, hash: document.hash }))
    .sort((left, right) => left.path.localeCompare(right.path) || left.id.localeCompare(right.id)));
}

function resolveWikiDir(projectRoot: string, wikiDir: string): string {
  const normalized = safeProjectRelativePath(wikiDir);
  if (!normalized) {
    throw new WikiPlanError("wiki.plan_wiki_dir", `Wiki directory must be project-relative: ${wikiDir}`, "Pass a safe project-relative --wiki-dir, for example wiki.");
  }
  return normalized;
}

function isUnderWikiDir(documentPath: string, wikiDir: string): boolean {
  return documentPath === wikiDir || documentPath.startsWith(`${wikiDir}/`);
}

function dependencySnapshot(projectRoot: string, repository: GraphRepository, page: WikiEvidencePage & Partial<WikiPlanPage>): WikiDependencySnapshot {
  const documents = new Map(repository.allDocuments().map((document) => [document.id, document]));
  const previous = page.dependencySnapshot;
  const previousById = new Map(previous?.documents.map((document) => [document.id, document]) ?? []);
  return {
    documents: page.documentIds.map((id) => {
      const document = documents.get(id);
      return document ? { id: document.id, path: document.path, hash: document.hash } : { id, path: previousById.get(id)?.path, missing: true };
    }),
    sourceRefs: page.sourceRefs.map((sourceRef) => ({ path: sourceRef, fingerprint: sourceRefFingerprint(projectRoot, sourceRef) }))
  };
}

function mergePlanPages(
  projectRoot: string,
  repository: GraphRepository,
  from: WikiPlan,
  generated: WikiPlanPage[],
  pageSuggestions: WikiPlanSuggestions["pages"],
  sourceSuggestions: WikiPlanSuggestions["sources"],
  wikiDir: string
): WikiPlanPage[] {
  const generatedById = new Map(generated.map((page) => [page.id, page]));
  const fromIds = new Set(from.pages.map((page) => page.id));
  const pages = from.pages.map((previous) => {
    const candidate = generatedById.get(previous.id);
    if (candidate) {
      const addedDocuments = candidate.documentIds.filter((id) => !previous.documentIds.includes(id));
      const addedSources = candidate.sourceRefs.filter((sourceRef) => !previous.sourceRefs.includes(sourceRef));
      if (addedDocuments.length || addedSources.length) sourceSuggestions.push({ pageId: previous.id, documentIds: addedDocuments, sourceRefs: addedSources });
    }
    const gaps = pageGaps(projectRoot, repository, previous, wikiDir);
    return {
      ...previous,
      evidenceHash: calculateWikiPageEvidenceHash(projectRoot, repository, previous),
      dependencySnapshot: dependencySnapshot(projectRoot, repository, previous), gaps
    };
  });
  for (const candidate of generated) {
    if (!fromIds.has(candidate.id)) pageSuggestions.push(candidate);
  }
  return pages;
}

function validateSuggestions(value: unknown): WikiPlanSuggestions {
  if (!isRecord(value) || !Array.isArray(value.pages) || !Array.isArray(value.sources)) {
    throw invalidPlan("wiki.plan_suggestions", "v2 suggestions must contain pages and sources arrays.");
  }
  return {
    pages: value.pages.map((item, index) => {
      if (!isRecord(item)) throw invalidPlan("wiki.plan_suggestions", `suggestions.pages[${index}] must be an object.`);
      return validateWikiPlanPage(item, index);
    }),
    sources: value.sources.map((item, index) => {
      if (!isRecord(item)) throw invalidPlan("wiki.plan_suggestions", `suggestions.sources[${index}] must be an object.`);
      return { pageId: requiredString(item.pageId, `suggestions.sources[${index}].pageId`), documentIds: stringArray(item.documentIds, `suggestions.sources[${index}].documentIds`), sourceRefs: stringArray(item.sourceRefs, `suggestions.sources[${index}].sourceRefs`).map((source) => { const safe = safeProjectRelativePath(source); if (!safe) throw invalidPlan("wiki.plan_suggestions", "Suggested sources must be project-relative."); return safe; }) };
    })
  };
}

function optionalDependencySnapshot(value: unknown, index: number): WikiDependencySnapshot | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !Array.isArray(value.documents) || !Array.isArray(value.sourceRefs)) {
    throw invalidPlan("wiki.plan_snapshot", `pages[${index}].dependencySnapshot must contain documents and sourceRefs arrays.`);
  }
  return {
    documents: value.documents.map((item, documentIndex) => {
      if (!isRecord(item) || typeof item.id !== "string" || !item.id) throw invalidPlan("wiki.plan_snapshot", `pages[${index}].dependencySnapshot.documents[${documentIndex}] must contain id.`);
      if (item.path !== undefined && (typeof item.path !== "string" || !safeProjectRelativePath(item.path))) throw invalidPlan("wiki.plan_snapshot", "Snapshot document paths must be project-relative.");
      if (item.missing === true) return { id: item.id, path: item.path as string | undefined, missing: true as const };
      if (typeof item.path !== "string" || typeof item.hash !== "string" || !isSha256(item.hash)) throw invalidPlan("wiki.plan_snapshot", `pages[${index}].dependencySnapshot.documents[${documentIndex}] must contain path and hash.`);
      return { id: item.id, path: item.path, hash: item.hash };
    }),
    sourceRefs: value.sourceRefs.map((item, sourceIndex) => {
      if (!isRecord(item) || typeof item.path !== "string" || !safeProjectRelativePath(item.path) || typeof item.fingerprint !== "string") throw invalidPlan("wiki.plan_snapshot", `pages[${index}].dependencySnapshot.sourceRefs[${sourceIndex}] must contain path and fingerprint.`);
      return { path: item.path, fingerprint: item.fingerprint };
    })
  };
}

function validateWikiPlanPage(value: unknown, index: number): WikiPlanPage {
  if (!isRecord(value)) {
    throw invalidPlan("wiki.plan_page_shape", `Wiki plan pages[${index}] must be an object.`);
  }
  const id = requiredString(value.id, `pages[${index}].id`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw invalidPlan("wiki.plan_page_id", `Wiki page ID must use lowercase letters, digits, and hyphens: ${id}.`);
  }
  const pagePath = safeWikiPagePath(requiredString(value.path, `pages[${index}].path`));
  if (!pagePath) {
    throw invalidPlan("wiki.plan_page_path", `Wiki page path must be a safe relative Markdown path: ${String(value.path)}.`);
  }
  const parentId = optionalString(value.parentId);
  const page: WikiPlanPage = {
    id,
    title: requiredString(value.title, `pages[${index}].title`),
    path: pagePath,
    parentId,
    purpose: requiredString(value.purpose, `pages[${index}].purpose`),
    audience: requiredString(value.audience, `pages[${index}].audience`),
    outline: stringArray(value.outline, `pages[${index}].outline`),
    documentIds: stringArray(value.documentIds, `pages[${index}].documentIds`),
    sourceRefs: stringArray(value.sourceRefs, `pages[${index}].sourceRefs`).map((sourceRef) => {
      const safe = safeProjectRelativePath(sourceRef);
      if (!safe) {
        throw invalidPlan("wiki.plan_source_ref", `Unsafe source ref in Wiki page ${id}: ${sourceRef}.`);
      }
      return safe;
    }),
    evidenceQueries: stringArray(value.evidenceQueries, `pages[${index}].evidenceQueries`),
    evidenceHash: requiredString(value.evidenceHash, `pages[${index}].evidenceHash`),
    dependencySnapshot: optionalDependencySnapshot(value.dependencySnapshot, index),
    gaps: validateGaps(value.gaps)
  };
  if (!isSha256(page.evidenceHash)) {
    throw invalidPlan("wiki.plan_evidence_hash", `Wiki page ${id} evidenceHash must be a SHA-256 string.`);
  }
  return page;
}

function pageGaps(projectRoot: string, repository: GraphRepository, page: WikiEvidencePage & Partial<WikiPlanPage>, wikiDir: string): WikiPlanGap[] {
  const documents = new Map(repository.allDocuments().map((document) => [document.id, document]));
  const gaps: WikiPlanGap[] = [];
  for (const id of page.documentIds) {
    const document = documents.get(id);
    const previousPath = page.dependencySnapshot?.documents.find((item) => item.id === id)?.path;
    if (!document || isUnderWikiDir(document.path, wikiDir)) gaps.push({ kind: "document", path: document?.path ?? previousPath,
      reason: !document ? `Selected document ${id} is no longer indexed.` : "Wiki output cannot serve as its own source evidence.",
      recovery: "Review the selected documentIds, restore or replace the source, and refresh the plan." });
  }
  for (const source of page.sourceRefs) {
    const fingerprint = sourceRefFingerprint(projectRoot, source);
    if (!/^[a-f0-9]{64}$/.test(fingerprint) || isUnderWikiDir(source, wikiDir)) gaps.push({ kind: "source_ref", path: source,
      reason: isUnderWikiDir(source, wikiDir) ? "Wiki output cannot serve as its own source evidence." : `Source reference is ${fingerprint}.`,
      recovery: "Inspect the source path and restore it or explicitly revise the selected sourceRefs before refreshing the plan." });
  }
  return gaps;
}

function validateGaps(value: unknown): WikiPlanGap[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw invalidPlan("wiki.plan_gaps", "gaps must be an array.");
  return value.map((gap) => {
    if (!isRecord(gap) || !["document", "source_ref", "domain"].includes(String(gap.kind))) throw invalidPlan("wiki.plan_gaps", "Gap kind must identify a document, source_ref, or domain.");
    if (gap.path !== undefined && (typeof gap.path !== "string" || !safeProjectRelativePath(gap.path))) throw invalidPlan("wiki.plan_gaps", "Gap paths must be project-relative.");
    return { kind: gap.kind as WikiPlanGap["kind"], path: gap.path as string | undefined, reason: requiredString(gap.reason, "gap.reason"), recovery: requiredString(gap.recovery, "gap.recovery") };
  });
}

function compareDocuments(left: GraphDocument, right: GraphDocument): number {
  return left.path.localeCompare(right.path) || left.id.localeCompare(right.id);
}

function invalidPlan(code: string, message: string): WikiPlanError {
  return new WikiPlanError(code, message, "Regenerate the artifact with `mdgraph wiki plan --out <plan-file>`." );
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw invalidPlan("wiki.plan_field", `${field} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw invalidPlan("wiki.plan_field", `${field} must be an array of non-empty strings.`);
  }
  return value.map((item) => (item as string).trim());
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveIntegerOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

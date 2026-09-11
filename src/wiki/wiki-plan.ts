import fs from "node:fs";
import path from "node:path";
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

export { calculateWikiPageEvidenceHash, safeProjectRelativePath, sourceRefFingerprint } from "./wiki-evidence.js";

export const WIKI_PLAN_FORMAT = "mdgraph-wiki-plan" as const;
export const WIKI_PLAN_FORMAT_VERSION = 1 as const;
export const WIKI_PAGE_BRIEF_FORMAT = "mdgraph-wiki-page-brief" as const;
export const WIKI_PAGE_BRIEF_FORMAT_VERSION = 1 as const;
const MAX_DOMAIN_SEEDS = 8;
const MAX_PAGE_DOCUMENTS = 12;
const MAX_BRIEF_CARDS = 8;

export interface WikiPlan {
  format: typeof WIKI_PLAN_FORMAT;
  formatVersion: typeof WIKI_PLAN_FORMAT_VERSION;
  graphHash: string;
  sourceHash: string;
  /** Additive strict Markdown content evidence for deciding whether to use this plan. */
  strictFreshness?: WikiStrictFreshness;
  pages: WikiPlanPage[];
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
}

export interface WikiPageBrief {
  format: typeof WIKI_PAGE_BRIEF_FORMAT;
  formatVersion: typeof WIKI_PAGE_BRIEF_FORMAT_VERSION;
  page: WikiPlanPage;
  maxChars: number;
  usedChars: number;
  sourceDocuments: WikiBriefSourceDocument[];
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

interface WikiDomain {
  id: string;
  title: string;
  path: string;
  purpose: string;
  audience: string;
  outline: string[];
  evidenceQueries: string[];
  score(document: GraphDocument): number;
}

interface WikiPageSeed extends Omit<WikiPlanPage, "evidenceHash">, WikiEvidencePage {}

const WIKI_DOMAINS: WikiDomain[] = [
  {
    id: "project-overview",
    title: "Project Overview",
    path: "index.md",
    purpose: "Explain the product boundary, core concepts, installation path, and the shortest successful workflow.",
    audience: "New users and coding agents evaluating or starting with the project.",
    outline: ["What the project is", "Core concepts", "Install and index", "First useful query", "Next steps"],
    evidenceQueries: ["product positioning and non-goals", "installation indexing first query"],
    score(document) {
      const text = documentText(document);
      return basenameScore(document.path, ["readme.md", "readme-zh.md"], 12)
        + keywordScore(text, ["overview", "introduction", "getting started", "quickstart", "project overview", "项目概览", "快速开始"], 4)
        + (document.path.split("/").length === 1 ? 2 : 0);
    }
  },
  {
    id: "architecture",
    title: "Architecture",
    path: "architecture.md",
    purpose: "Describe implemented module boundaries, data flow, architectural decisions, and important tradeoffs.",
    audience: "Maintainers and contributors changing cross-module behavior.",
    outline: ["System boundary", "Module map", "Data and query flow", "Key decisions", "Tradeoffs and extension points"],
    evidenceQueries: ["implemented architecture module boundaries", "architecture decisions and tradeoffs"],
    score(document) {
      const text = documentText(document);
      return (document.type === "adr" ? 8 : document.type === "design" ? 5 : 0)
        + keywordScore(text, ["architecture", "architectural", " adr", "decision", "design", "架构", "设计", "决策"], 3);
    }
  },
  {
    id: "core-workflows",
    title: "Core Workflows",
    path: "core-workflows.md",
    purpose: "Explain the main end-to-end user and agent workflows with their evidence and source entry points.",
    audience: "Users and coding agents applying the project to real work.",
    outline: ["Indexing workflow", "Retrieval workflow", "Graph navigation", "Agent integration", "Workflow boundaries"],
    evidenceQueries: ["core indexing and retrieval workflows", "agent search context node trace workflow"],
    score(document) {
      return keywordScore(documentText(document), [
        "workflow", "retrieval", "context", "indexing", "search", "trace", "query", "relationship", "工作流", "检索", "索引", "查询"
      ], 3) + (document.type === "spec" ? 2 : 0);
    }
  },
  {
    id: "development",
    title: "Development Guide",
    path: "development.md",
    purpose: "Give contributors the commands, conventions, test strategy, and repository boundaries needed to make safe changes.",
    audience: "Contributors and maintainers implementing or reviewing changes.",
    outline: ["Development setup", "Repository conventions", "Build and test", "Change workflow", "Contribution checks"],
    evidenceQueries: ["development setup build test commands", "contribution conventions and repository boundaries"],
    score(document) {
      const text = documentText(document);
      return basenameScore(document.path, ["agents.md", "contributing.md"], 10)
        + keywordScore(text, ["development", "contributing", "build", "testing", "setup", "configuration", "开发", "贡献", "测试", "配置"], 3);
    }
  },
  {
    id: "operations",
    title: "Operations and Troubleshooting",
    path: "operations.md",
    purpose: "Explain runtime operation, diagnostics, failure recovery, freshness, and provider or watcher troubleshooting.",
    audience: "Users and maintainers diagnosing an unhealthy or stale project workflow.",
    outline: ["Operational model", "Freshness and watch", "Diagnostics", "Common failures", "Recovery paths"],
    evidenceQueries: ["operations troubleshooting doctor freshness", "watch provider failure recovery"],
    score(document) {
      const text = documentText(document);
      return (document.type === "runbook" || document.type === "incident" ? 8 : 0)
        + keywordScore(text, ["operations", "runbook", "incident", "troubleshoot", "doctor", "watch", "provider", "release", "运行", "排障", "故障", "诊断"], 3);
    }
  },
  {
    id: "reference",
    title: "Reference",
    path: "reference.md",
    purpose: "Collect stable command, MCP, configuration, API, and output contracts without duplicating implementation prose.",
    audience: "Users and tool authors who need exact public names, inputs, outputs, and compatibility boundaries.",
    outline: ["CLI reference", "MCP tools", "Configuration", "Output contracts", "Compatibility status"],
    evidenceQueries: ["CLI MCP API configuration reference", "public output contracts and compatibility"],
    score(document) {
      return (document.type === "api" ? 7 : 0)
        + keywordScore(documentText(document), ["reference", " cli", "mcp", " api", "configuration", "output contract", "public contract", "参考", "命令", "公开契约"], 3);
    }
  }
];

export function buildWikiPlan(projectRoot: string, repository: GraphRepository): WikiPlan {
  const graph = buildGraphJsonExport(projectRoot, repository);
  const strictFreshness = wikiStrictFreshness(projectRoot, repository);
  const documents = repository.allDocuments();
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const relatedDocuments = relatedDocumentIdsByDocument(repository);
  const sourceRefsByDocument = sourceRefsByDocumentId(repository);
  const selectedByDomain = WIKI_DOMAINS.map((domain) => ({
    domain,
    documents: expandDomainDocuments(rankedDomainDocuments(domain, documents), documentsById, relatedDocuments)
  }));
  if (documents.length && !selectedByDomain[0].documents.length) {
    selectedByDomain[0].documents = [documents.slice().sort(compareDocuments)[0]];
  }
  const hasOverview = selectedByDomain[0].documents.length > 0;
  const pages = selectedByDomain
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
        outline: [...domain.outline],
        documentIds,
        sourceRefs,
        evidenceQueries: [...domain.evidenceQueries]
      };
      return {
        ...seed,
        evidenceHash: calculateWikiPageEvidenceHash(projectRoot, repository, seed)
      };
    });
  return {
    format: WIKI_PLAN_FORMAT,
    formatVersion: WIKI_PLAN_FORMAT_VERSION,
    graphHash: graph.graphHash,
    sourceHash: graph.sourceHash,
    strictFreshness,
    pages
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
  const plannedDocuments = page.documentIds.flatMap((documentId) => {
    const document = documentsById.get(documentId);
    return document ? [document] : [];
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
  const builder = createKnowledgeCardBuilder(repository);
  const cardNodeIds = uniqueStrings([
    ...page.documentIds,
    ...context.items.map((item) => item.nodeId)
  ]);
  const knowledgeCards: KnowledgeCard[] = [];
  let usedChars = context.usedChars;
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
  const currentEvidenceHash = calculateWikiPageEvidenceHash(projectRoot, repository, page);
  const strictFreshness = wikiStrictFreshness(projectRoot, repository);
  const writingRequirements = [
    `Write for this audience: ${page.audience}`,
    `Make the page achieve this purpose: ${page.purpose}`,
    "Use the outline as guidance, not as text to copy mechanically.",
    "Read the listed source documents and inspect listed source refs before making behavioral claims.",
    "Distinguish directly evidenced behavior from conclusions that still require source verification.",
    "Keep project-relative source_docs and source_refs in front matter, and preserve wiki_id and evidence_hash.",
    "Do not overwrite or rewrite unrelated Wiki pages.",
    strictFreshness.state === "fresh" && currentEvidenceHash === page.evidenceHash
      ? `Set evidence_hash to ${page.evidenceHash}.`
      : `Indexed Markdown evidence is ${strictFreshness.state}; run \`mdgraph index\`, regenerate the Wiki plan, then update this page from its new brief. Do not set evidence_hash from this stale plan.`
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
    contextItems: context.items,
    knowledgeCards,
    writingRequirements,
    suggestedNextQueries,
    strictFreshness
  };
}

export function stableWikiPlan(plan: WikiPlan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

function wikiStrictFreshness(projectRoot: string, repository: GraphRepository): WikiStrictFreshness {
  const freshness = wikiContentFreshness(projectRoot, repository);
  return {
    state: freshness.state,
    recommendation: freshness.recommendation,
    issues: freshness.issues
  };
}

export function formatWikiPlan(plan: WikiPlan): string {
  const lines = [
    `Wiki plan: ${plan.pages.length} page(s)`,
    `Graph hash: ${plan.graphHash}`,
    `Source hash: ${plan.sourceHash}`
  ];
  for (const page of plan.pages) {
    lines.push(`- ${page.id}: ${page.path} (${page.documentIds.length} document(s), ${page.sourceRefs.length} source ref(s))`);
  }
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
    `Evidence freshness: ${brief.strictFreshness.state}`,
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
  if (value.formatVersion !== WIKI_PLAN_FORMAT_VERSION) {
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
  for (const page of pages) {
    if (page.parentId && (!ids.has(page.parentId) || page.parentId === page.id)) {
      throw invalidPlan("wiki.plan_parent", `Invalid parentId for Wiki page ${page.id}: ${page.parentId}.`);
    }
  }
  return {
    format: WIKI_PLAN_FORMAT,
    formatVersion: WIKI_PLAN_FORMAT_VERSION,
    graphHash: value.graphHash,
    sourceHash: value.sourceHash,
    strictFreshness: optionalWikiStrictFreshness(value.strictFreshness),
    pages
  };
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
    evidenceHash: requiredString(value.evidenceHash, `pages[${index}].evidenceHash`)
  };
  if (!isSha256(page.evidenceHash)) {
    throw invalidPlan("wiki.plan_evidence_hash", `Wiki page ${id} evidenceHash must be a SHA-256 string.`);
  }
  return page;
}

function documentText(document: GraphDocument): string {
  return ` ${document.path} ${document.title} ${document.type} `.toLowerCase();
}

function keywordScore(text: string, keywords: string[], weight: number): number {
  return keywords.reduce((score, keyword) => score + (text.includes(keyword) ? weight : 0), 0);
}

function basenameScore(documentPath: string, names: string[], score: number): number {
  return names.includes(path.posix.basename(documentPath).toLowerCase()) ? score : 0;
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

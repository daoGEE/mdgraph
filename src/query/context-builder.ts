import type { EdgeKind, GraphDocument, GraphEdge, GraphEntity, MDGraphConfig, Provenance, SearchResult, SourceRef, TrustTier } from "../types.js";
import { GraphRepository, type ChunkSearchRow, type NodeRecord } from "../db/repositories.js";
import { explainSearchGraphAsync, searchGraph, type SearchOptions } from "./search.js";
import type { EmbeddingDiagnostic } from "../semantic/provider.js";
import { scanContentRiskLines } from "../utils/content-risk.js";
import { normalizePath, uniqueStrings } from "../utils/text.js";

const DEFAULT_MAX_CONTEXT_NODES = 16;
export const CONTEXT_PACKING_STRATEGY = "mmr-style-document-round-robin" as const;
export const CONTEXT_PACKING_STRATEGIES = [CONTEXT_PACKING_STRATEGY, "mmr"] as const;
export type ContextPackingStrategy = typeof CONTEXT_PACKING_STRATEGIES[number];
export const DEFAULT_MMR_LAMBDA = 0.65;
const MMR_SAME_DOCUMENT_REDUNDANCY_THRESHOLD = 0.8;

export interface ContextItem {
  nodeId: string;
  documentId: string;
  sectionId?: string;
  anchor?: string;
  path: string;
  title: string;
  heading?: string;
  lines?: { start: number; end: number };
  reason: string;
  matchedEntities: string[];
  edgePath?: ContextEdgePathStep[];
  sourceRefs?: ContextSourceRef[];
  riskNotes?: string[];
  content: string;
}

export interface ContextEdgePathStep {
  fromId: string;
  fromLabel: string;
  edgeFromId: string;
  edgeToId: string;
  edgeKind: EdgeKind;
  toId: string;
  toLabel: string;
  traversalDirection: "forward" | "reverse";
  confidence: number;
  provenance: Provenance;
}

export interface ContextSourceRef {
  path: string;
  edgeKind: Extract<EdgeKind, "IMPLEMENTS" | "REFERENCES_SOURCE">;
  provenance: Provenance;
  confidence: number;
}

export interface ContextAutoMode {
  name: "auto" | "manual";
  searchLimit: number;
  maxDepth: number;
  maxChars: number;
  reason: string;
}

export interface ContextResult {
  query: string;
  maxChars: number;
  usedChars: number;
  packing: ContextPackingInfo;
  knownFiles?: string[];
  suggestedNextQueries?: string[];
  mode?: ContextAutoMode;
  semanticDiagnostic?: EmbeddingDiagnostic;
  items: ContextItem[];
  debug?: ContextDebug;
}

export interface ContextPackingInfo {
  strategy: ContextPackingStrategy;
  similarity?: ContextPackingSimilarity;
  mmrLambda?: number;
  redundancySkippedItems?: number;
}

export interface ContextDebug {
  seedNodes: number;
  visitedNodes: number;
  expandedEdges: number;
  skippedVisitedNodes: number;
  skippedByNodeLimit: number;
  skippedByDepth: number;
  candidateCount: number;
  directCandidates: number;
  expandedCandidates: number;
  packingStrategy: ContextPackingStrategy;
  packingSimilarity?: ContextPackingSimilarity;
  mmrLambda?: number;
  packingSelections?: ContextPackingSelection[];
  packedItems: number;
  packedUniqueDocuments: number;
  packingDiversityRatio: number;
  budgetTruncatedItems: number;
  budgetSkippedItems: number;
  redundancySkippedItems?: number;
}

export type ContextPackingSimilarity = "embedding-cosine" | "hybrid" | "lexical-jaccard";

export interface ContextPackingSelection {
  nodeId: string;
  path: string;
  queryRelevance: number;
  redundancyPenalty: number;
  mmrScore: number;
  similaritySource: "embedding-cosine" | "lexical-jaccard" | "none";
}

interface ContextCandidate extends ContextItem {
  chunkId?: string;
  documentStatus: string;
  trustTier: TrustTier;
  trustTierDeclared: boolean;
  score: number;
  direct: boolean;
}

interface ExpansionQueueItem {
  nodeId: string;
  depth: number;
  score: number;
  path: ContextEdgePathStep[];
}

export interface ContextBuildOptions {
  debug?: boolean;
  maxChars?: number;
  knownFiles?: string[];
  searchLimit?: number;
  maxDepth?: number;
  mode?: ContextAutoMode;
  packingStrategy?: ContextPackingStrategy;
  mmrLambda?: number;
  searchOptions?: SearchOptions;
}

interface ContextCollection {
  candidates: ContextCandidate[];
  debug: Omit<
    ContextDebug,
    | "candidateCount"
    | "directCandidates"
    | "expandedCandidates"
    | "packingStrategy"
    | "packedItems"
    | "packedUniqueDocuments"
    | "packingDiversityRatio"
    | "budgetTruncatedItems"
    | "budgetSkippedItems"
    | "redundancySkippedItems"
    | "packingSimilarity"
    | "mmrLambda"
    | "packingSelections"
  >;
}

interface PackedContext {
  result: ContextResult;
  packingStrategy: ContextPackingStrategy;
  packingSimilarity?: ContextPackingSimilarity;
  mmrLambda?: number;
  packingSelections?: ContextPackingSelection[];
  budgetTruncatedItems: number;
  budgetSkippedItems: number;
  redundancySkippedItems: number;
}

export function buildContext(
  repository: GraphRepository,
  config: MDGraphConfig,
  query: string,
  options: ContextBuildOptions = {}
): ContextResult {
  const searchLimit = positiveIntegerOr(options.searchLimit, config.search.defaultLimit * 2);
  const results = searchGraph(repository, config, query, searchLimit, options.searchOptions);
  return buildContextFromSearchResults(repository, config, query, results, options);
}

export async function buildContextAsync(
  repository: GraphRepository,
  config: MDGraphConfig,
  query: string,
  options: ContextBuildOptions = {}
): Promise<ContextResult> {
  const searchLimit = positiveIntegerOr(options.searchLimit, config.search.defaultLimit * 2);
  const explanation = await explainSearchGraphAsync(repository, config, query, searchLimit, options.searchOptions);
  return buildContextFromSearchResults(repository, config, query, explanation.results, options, explanation.semanticDiagnostic);
}

export function buildContextFromSearchResults(
  repository: GraphRepository,
  config: MDGraphConfig,
  query: string,
  results: SearchResult[],
  options: ContextBuildOptions,
  semanticDiagnostic?: EmbeddingDiagnostic
): ContextResult {
  const knownFiles = normalizeKnownFiles(options.knownFiles ?? []);
  const maxChars = positiveIntegerOr(options.maxChars, config.search.maxContextChars);
  const maxDepth = positiveIntegerOr(options.maxDepth, config.search.maxDepth);
  const collection = collectContextCandidates(repository, config, results, maxDepth);
  const candidates = knownFiles.length
    ? mergeKnownFileCandidates(repository, collection.candidates, knownFiles)
    : collection.candidates;
  const packingStrategy = options.packingStrategy ?? CONTEXT_PACKING_STRATEGY;
  const packed = packContext(
    repository,
    config,
    query,
    enrichContextCandidates(repository, candidates),
    maxChars,
    options.mode,
    packingStrategy,
    mmrLambdaOrDefault(options.mmrLambda)
  );
  const hinted = addAgentHints(packed.result, knownFiles);
  const result = semanticDiagnostic ? { ...hinted, semanticDiagnostic } : hinted;
  if (!options.debug) {
    return result;
  }
  return {
    ...result,
    debug: {
      ...collection.debug,
      candidateCount: candidates.length,
      directCandidates: candidates.filter((candidate) => candidate.direct).length,
      expandedCandidates: candidates.filter((candidate) => !candidate.direct).length,
      packingStrategy: packed.packingStrategy,
      packingSimilarity: packed.packingSimilarity,
      mmrLambda: packed.mmrLambda,
      packingSelections: packed.packingSelections,
      packedItems: result.items.length,
      packedUniqueDocuments: uniqueStrings(result.items.map((item) => item.path)).length,
      packingDiversityRatio: result.items.length
        ? Number((uniqueStrings(result.items.map((item) => item.path)).length / result.items.length).toFixed(4))
        : 0,
      budgetTruncatedItems: packed.budgetTruncatedItems,
      budgetSkippedItems: packed.budgetSkippedItems,
      redundancySkippedItems: packed.redundancySkippedItems || undefined
    }
  };
}

function mergeKnownFileCandidates(
  repository: GraphRepository,
  candidates: ContextCandidate[],
  knownFiles: string[]
): ContextCandidate[] {
  const merged = new Map<string, ContextCandidate>();
  for (const candidate of candidates) {
    addCandidate(merged, candidate);
  }
  knownFiles.forEach((knownFile, index) => {
    for (const candidate of candidatesForKnownFile(repository, knownFile, index)) {
      addCandidate(merged, candidate);
    }
  });
  return orderContextCandidates([...merged.values()]);
}

function candidatesForKnownFile(repository: GraphRepository, knownFile: string, index: number): ContextCandidate[] {
  const resolution = resolveKnownFile(repository, knownFile);
  if (resolution?.kind !== "source_ref") {
    const directRow = resolution ? repository.contextChunkForNode(resolution.id) : undefined;
    return directRow ? [candidateFromKnownRow(directRow, `known file ${knownFile}`, index)] : [];
  }

  return repository.edgesForNode(resolution.id)
    .map((edge) => {
      const otherId = edge.fromId === resolution.id ? edge.toId : edge.fromId;
      const row = repository.contextChunkForNode(otherId);
      return row ? candidateFromKnownRow(row, `known file ${knownFile} via ${edge.kind}/${edge.provenance}`, index) : undefined;
    })
    .filter((candidate): candidate is ContextCandidate => Boolean(candidate));
}

function resolveKnownFile(repository: GraphRepository, knownFile: string): NodeRecord | undefined {
  const queries = uniqueStrings([knownFile, normalizePath(knownFile)]);
  for (const query of queries) {
    const resolution = repository.resolveNodeDetailed(query);
    if (resolution.status === "found") {
      return resolution.node;
    }
  }
  return undefined;
}

function candidateFromKnownRow(row: ChunkSearchRow, reason: string, index: number): ContextCandidate {
  return {
    path: row.document.path,
    title: row.document.title,
    heading: row.section?.heading,
    sectionId: row.section?.id,
    anchor: row.section?.anchor,
    lines: row.section ? { start: row.section.startLine, end: row.section.endLine } : undefined,
    reason,
    matchedEntities: [],
    content: row.chunk.content,
    nodeId: row.section?.id ?? row.document.id,
    documentId: row.document.id,
    documentStatus: row.document.status,
    trustTier: row.document.trustTier,
    trustTierDeclared: hasDeclaredTrustTier(row.document),
    score: 10_000 - index,
    direct: true
  };
}

function addAgentHints(result: ContextResult, knownFiles: string[]): ContextResult {
  const suggestedNextQueries = suggestedQueries(result, knownFiles);
  return {
    ...result,
    knownFiles: knownFiles.length ? knownFiles : undefined,
    suggestedNextQueries: suggestedNextQueries.length ? suggestedNextQueries : undefined
  };
}

function suggestedQueries(result: ContextResult, knownFiles: string[]): string[] {
  const paths = uniqueStrings(result.items.map((item) => item.path));
  const entities = uniqueStrings(result.items.flatMap((item) => item.matchedEntities.map(entityNameOnly)));
  const suggestions = [
    paths[0] ? `mdgraph_node ${suggestedArgument(paths[0])}` : "",
    knownFiles[0] && paths[0] ? `mdgraph_trace ${suggestedArgument(knownFiles[0])} ${suggestedArgument(paths[0])}` : "",
    entities[0] ? `mdgraph_search ${suggestedArgument(entities[0])}` : ""
  ];
  return uniqueStrings(suggestions).slice(0, 3);
}

function suggestedArgument(value: string): string {
  return JSON.stringify(value);
}

function entityNameOnly(value: string): string {
  return value.replace(/\s+\([^)]*\)$/u, "");
}

function normalizeKnownFiles(values: string[]): string[] {
  return uniqueStrings(values.map((value) => normalizePath(value)));
}

function positiveIntegerOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function collectContextCandidates(
  repository: GraphRepository,
  config: MDGraphConfig,
  results: SearchResult[],
  maxDepth: number
): ContextCollection {
  let remainingExpansionNodes = Math.max(DEFAULT_MAX_CONTEXT_NODES, config.search.defaultLimit * 2);
  const candidates = new Map<string, ContextCandidate>();
  const queue: ExpansionQueueItem[] = [];
  const visited = new Set<string>();
  const debug = {
    seedNodes: 0,
    visitedNodes: 0,
    expandedEdges: 0,
    skippedVisitedNodes: 0,
    skippedByNodeLimit: 0,
    skippedByDepth: 0
  };

  for (const result of results) {
    addCandidate(candidates, candidateFromSearchResult(result));
    for (const seed of seedsFromSearchResult(result)) {
      if (visited.has(seed.nodeId)) {
        debug.skippedVisitedNodes += 1;
        continue;
      }
      visited.add(seed.nodeId);
      debug.seedNodes += 1;
      queue.push({ nodeId: seed.nodeId, depth: 0, score: result.score, path: [] });
    }
  }

  while (queue.length) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) {
      debug.skippedByDepth += 1;
      continue;
    }

    const edges = repository.edgesForNode(current.nodeId)
      .filter((edge) => edge.kind !== "CONTAINS")
      .sort((left, right) => edgeScore(right) - edgeScore(left));

    for (const edge of edges) {
      const nextId = edge.fromId === current.nodeId ? edge.toId : edge.fromId;
      if (visited.has(nextId)) {
        debug.skippedVisitedNodes += 1;
        continue;
      }
      if (remainingExpansionNodes <= 0) {
        debug.skippedByNodeLimit += 1;
        continue;
      }

      const step = expansionPathStep(repository, current.nodeId, edge);
      const path = [...current.path, step];
      const score = current.score + edgeScore(edge) - (current.depth + 1) * 2;
      visited.add(nextId);
      remainingExpansionNodes -= 1;
      debug.expandedEdges += 1;

      const row = repository.contextChunkForNode(nextId);
      if (row) {
        addCandidate(candidates, {
          path: row.document.path,
          title: row.document.title,
          heading: row.section?.heading,
          sectionId: row.section?.id,
          anchor: row.section?.anchor,
          lines: row.section ? { start: row.section.startLine, end: row.section.endLine } : undefined,
          reason: `graph expansion via ${path.map(formatExpansionStep).join(" | ")}`,
          matchedEntities: [],
          edgePath: path,
          content: row.chunk.content,
          nodeId: row.section?.id ?? row.document.id,
          documentId: row.document.id,
          documentStatus: row.document.status,
          trustTier: row.document.trustTier,
          trustTierDeclared: hasDeclaredTrustTier(row.document),
          score,
          direct: false
        });
      }

      queue.push({ nodeId: nextId, depth: current.depth + 1, score, path });
    }

    queue.sort((left, right) => right.score - left.score);
  }

  return {
    candidates: orderContextCandidates([...candidates.values()]),
    debug: {
      ...debug,
      visitedNodes: visited.size
    }
  };
}

function enrichContextCandidates(repository: GraphRepository, candidates: ContextCandidate[]): ContextCandidate[] {
  return candidates.map((candidate) => {
    const row = repository.contextChunkForNode(candidate.nodeId);
    const sourceRefs = sourceRefsForCandidate(repository, candidate);
    const riskNotes = riskNotesForCandidate(candidate);
    return {
      ...candidate,
      chunkId: row?.chunk.id,
      sourceRefs: sourceRefs.length ? sourceRefs : undefined,
      riskNotes: riskNotes.length ? riskNotes : undefined
    };
  });
}

function sourceRefsForCandidate(repository: GraphRepository, candidate: ContextCandidate): ContextSourceRef[] {
  const edgeNodes = uniqueStrings([candidate.nodeId, candidate.documentId]);
  const refs = new Map<string, ContextSourceRef>();
  for (const nodeId of edgeNodes) {
    for (const edge of repository.edgesForNode(nodeId)) {
      if (edge.kind !== "IMPLEMENTS" && edge.kind !== "REFERENCES_SOURCE") {
        continue;
      }
      const otherId = edge.fromId === nodeId ? edge.toId : edge.fromId;
      const other = repository.getNode(otherId);
      if (other?.kind !== "source_ref") {
        continue;
      }
      const sourceRef = other.data as SourceRef;
      const ref = {
        path: sourceRef.path,
        edgeKind: edge.kind,
        provenance: edge.provenance,
        confidence: edge.confidence
      };
      refs.set(`${ref.path}:${ref.edgeKind}`, ref);
    }
  }
  return [...refs.values()].sort((left, right) => left.path.localeCompare(right.path) || left.edgeKind.localeCompare(right.edgeKind));
}

function riskNotesForCandidate(candidate: ContextCandidate): string[] {
  const notes: string[] = [];
  const status = candidate.documentStatus.trim().toLowerCase();
  if (status && status !== "active") {
    notes.push(`document status: ${candidate.documentStatus}`);
  }
  if (candidate.trustTier !== "authored" && candidate.trustTier !== "validated") {
    notes.push(`trust tier: ${candidate.trustTier}`);
  }
  if (candidate.trustTier === "validated" && candidate.trustTierDeclared) {
    notes.push("trust tier: validated (front matter declared)");
  }
  for (const risk of scanContentRiskLines(candidate.content).slice(0, 3)) {
    const line = candidate.lines ? candidate.lines.start + risk.line - 1 : risk.line;
    notes.push(`content risk: ${risk.reason} at line ${line}`);
  }
  return notes;
}

function orderContextCandidates(candidates: ContextCandidate[]): ContextCandidate[] {
  return [
    ...orderContextCandidatesByPath(candidates.filter((candidate) => candidate.direct).sort(compareContextCandidates)),
    ...orderContextCandidatesByPath(candidates.filter((candidate) => !candidate.direct).sort(compareContextCandidates))
  ];
}

function orderContextCandidatesByPath(sorted: ContextCandidate[]): ContextCandidate[] {
  const byPath = new Map<string, ContextCandidate[]>();
  for (const candidate of sorted) {
    byPath.set(candidate.path, [...(byPath.get(candidate.path) ?? []), candidate]);
  }

  const ordered: ContextCandidate[] = [];
  while (byPath.size) {
    for (const [candidatePath, pathCandidates] of byPath) {
      const [candidate, ...remaining] = pathCandidates;
      if (candidate) {
        ordered.push(candidate);
      }
      if (remaining.length) {
        byPath.set(candidatePath, remaining);
      } else {
        byPath.delete(candidatePath);
      }
    }
  }
  return ordered;
}

function compareContextCandidates(left: ContextCandidate, right: ContextCandidate): number {
  if (left.direct !== right.direct) {
    return left.direct ? -1 : 1;
  }
  return right.score - left.score;
}

function packContext(
  repository: GraphRepository,
  config: MDGraphConfig,
  query: string,
  candidates: ContextCandidate[],
  maxChars: number,
  mode: ContextAutoMode | undefined,
  packingStrategy: ContextPackingStrategy,
  mmrLambda: number
): PackedContext {
  const ranking = packingStrategy === "mmr"
    ? rankCandidatesWithMmr(repository, config, candidates, mmrLambda)
    : { candidates, redundancySkippedItems: 0 };
  const items: ContextItem[] = [];
  let usedChars = 0;
  let budgetTruncatedItems = 0;
  let budgetSkippedItems = 0;

  for (let index = 0; index < ranking.candidates.length; index += 1) {
    const candidate = ranking.candidates[index];
    const remaining = maxChars - usedChars;
    if (remaining <= 0) {
      budgetSkippedItems += ranking.candidates.length - index;
      break;
    }
    const content = trimToBudget(candidate.content, remaining);
    if (!content) {
      budgetSkippedItems += 1;
      continue;
    }
    if (content.length < candidate.content.length) {
      budgetTruncatedItems += 1;
    }
    usedChars += content.length;
    items.push({
      nodeId: candidate.nodeId,
      documentId: candidate.documentId,
      sectionId: candidate.sectionId,
      anchor: candidate.anchor,
      path: candidate.path,
      title: candidate.title,
      heading: candidate.heading,
      lines: candidate.lines,
      reason: candidate.reason,
      matchedEntities: candidate.matchedEntities,
      edgePath: candidate.edgePath,
      sourceRefs: candidate.sourceRefs,
      riskNotes: candidate.riskNotes,
      content
    });
  }

  return {
    result: {
      query,
      maxChars,
      usedChars,
      mode,
      items,
      packing: {
        strategy: packingStrategy,
        similarity: ranking.packingSimilarity,
        mmrLambda: packingStrategy === "mmr" ? mmrLambda : undefined,
        redundancySkippedItems: ranking.redundancySkippedItems || undefined
      }
    },
    packingStrategy,
    packingSimilarity: ranking.packingSimilarity,
    mmrLambda: packingStrategy === "mmr" ? mmrLambda : undefined,
    packingSelections: ranking.packingSelections,
    budgetTruncatedItems,
    budgetSkippedItems,
    redundancySkippedItems: ranking.redundancySkippedItems
  };
}

interface MmrRanking {
  candidates: ContextCandidate[];
  packingSimilarity?: ContextPackingSimilarity;
  packingSelections?: ContextPackingSelection[];
  redundancySkippedItems: number;
}

function rankCandidatesWithMmr(
  repository: GraphRepository,
  config: MDGraphConfig,
  candidates: ContextCandidate[],
  lambda: number
): MmrRanking {
  if (!candidates.length) {
    return {
      candidates: [],
      packingSimilarity: "lexical-jaccard",
      packingSelections: [],
      redundancySkippedItems: 0
    };
  }

  const vectors = repository.chunkVectors(
    candidates.flatMap((candidate) => candidate.chunkId ? [candidate.chunkId] : []),
    config.embedding.provider,
    config.embedding.model,
    config.embedding.dimensions
  );
  const tokenSets = new Map(candidates.map((candidate) => [candidate.nodeId, tokensForSimilarity(candidate.content)]));
  const remaining = candidates.map((candidate, order) => ({ candidate, order }));
  const selected: ContextCandidate[] = [];
  const selections: ContextPackingSelection[] = [];
  let redundancySkippedItems = 0;
  const maximumScore = Math.max(...candidates.map((candidate) => Math.max(0, candidate.score)), 1);

  while (remaining.length) {
    const scored = remaining.map((entry) => {
      const queryRelevance = clamp01(Math.max(0, entry.candidate.score) / maximumScore);
      const similarities = selected.map((other) => candidateSimilarity(entry.candidate, other, vectors, tokenSets));
      const mostRedundant = similarities.reduce<{ value: number; source: ContextPackingSelection["similaritySource"] }>(
        (best, current) => current.value > best.value ? current : best,
        { value: 0, source: "none" }
      );
      return {
        ...entry,
        queryRelevance,
        redundancyPenalty: mostRedundant.value,
        similaritySource: mostRedundant.source,
        mmrScore: lambda * queryRelevance - (1 - lambda) * mostRedundant.value
      };
    }).sort((left, right) => (
      right.mmrScore - left.mmrScore
      || right.queryRelevance - left.queryRelevance
      || left.order - right.order
    ));
    const best = scored[0];
    const remainingIndex = remaining.findIndex((entry) => entry.order === best.order);
    remaining.splice(remainingIndex, 1);

    const repeatsSelectedDocument = selected.some((candidate) => candidate.path === best.candidate.path);
    if (repeatsSelectedDocument && best.redundancyPenalty >= MMR_SAME_DOCUMENT_REDUNDANCY_THRESHOLD) {
      redundancySkippedItems += 1;
      continue;
    }

    selected.push(best.candidate);
    selections.push({
      nodeId: best.candidate.nodeId,
      path: best.candidate.path,
      queryRelevance: roundScore(best.queryRelevance),
      redundancyPenalty: roundScore(best.redundancyPenalty),
      mmrScore: roundScore(best.mmrScore),
      similaritySource: best.similaritySource
    });
  }

  const vectorCandidateCount = candidates.filter((candidate) => candidate.chunkId && vectors.has(candidate.chunkId)).length;
  return {
    candidates: selected,
    packingSimilarity: vectorCandidateCount === candidates.length
      ? "embedding-cosine"
      : vectorCandidateCount > 1 ? "hybrid" : "lexical-jaccard",
    packingSelections: selections,
    redundancySkippedItems
  };
}

function candidateSimilarity(
  left: ContextCandidate,
  right: ContextCandidate,
  vectors: Map<string, number[]>,
  tokenSets: Map<string, Set<string>>
): { value: number; source: "embedding-cosine" | "lexical-jaccard" } {
  const leftVector = left.chunkId ? vectors.get(left.chunkId) : undefined;
  const rightVector = right.chunkId ? vectors.get(right.chunkId) : undefined;
  if (leftVector && rightVector && leftVector.length === rightVector.length) {
    return { value: clamp01(cosineSimilarity(leftVector, rightVector)), source: "embedding-cosine" };
  }
  return {
    value: jaccardSimilarity(tokenSets.get(left.nodeId) ?? new Set(), tokenSets.get(right.nodeId) ?? new Set()),
    source: "lexical-jaccard"
  };
}

function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }
  return leftMagnitude > 0 && rightMagnitude > 0 ? dot / Math.sqrt(leftMagnitude * rightMagnitude) : 0;
}

function tokensForSimilarity(content: string): Set<string> {
  return new Set(content.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
}

function jaccardSimilarity(left: Set<string>, right: Set<string>): number {
  if (!left.size && !right.size) {
    return 0;
  }
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }
  return intersection / (left.size + right.size - intersection);
}

function mmrLambdaOrDefault(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : DEFAULT_MMR_LAMBDA;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function roundScore(value: number): number {
  return Number(value.toFixed(4));
}

function candidateFromSearchResult(result: SearchResult): ContextCandidate {
  return {
    path: result.document.path,
    title: result.document.title,
    heading: result.section?.heading,
    sectionId: result.section?.id,
    anchor: result.section?.anchor,
    lines: result.section ? { start: result.section.startLine, end: result.section.endLine } : undefined,
    reason: result.reason,
    matchedEntities: result.matchedEntities.map(formatMatchedEntity),
    content: result.content,
    nodeId: result.section?.id ?? result.document.id,
    documentId: result.document.id,
    documentStatus: result.document.status,
    trustTier: result.document.trustTier,
    trustTierDeclared: hasDeclaredTrustTier(result.document),
    score: result.score,
    direct: true
  };
}

function seedsFromSearchResult(result: SearchResult): Array<{ nodeId: string }> {
  const seeds = new Set<string>();
  seeds.add(result.document.id);
  if (result.section) {
    seeds.add(result.section.id);
  }
  for (const entity of result.matchedEntities) {
    seeds.add(entity.id);
  }
  return [...seeds].map((nodeId) => ({ nodeId }));
}

function addCandidate(candidates: Map<string, ContextCandidate>, candidate: ContextCandidate): void {
  const key = candidate.nodeId;
  const existing = candidates.get(key);
  if (!existing || candidate.score > existing.score || (candidate.direct && !existing.direct)) {
    candidates.set(key, candidate);
  }
}

function edgeScore(edge: GraphEdge): number {
  return edge.weight * edge.confidence;
}

function expansionPathStep(repository: GraphRepository, currentId: string, edge: GraphEdge): ContextEdgePathStep {
  const nextId = edge.fromId === currentId ? edge.toId : edge.fromId;
  return {
    fromId: currentId,
    fromLabel: repository.getNode(currentId)?.label ?? currentId,
    edgeFromId: edge.fromId,
    edgeToId: edge.toId,
    edgeKind: edge.kind,
    toId: nextId,
    toLabel: repository.getNode(nextId)?.label ?? nextId,
    traversalDirection: edge.fromId === currentId ? "forward" : "reverse",
    confidence: edge.confidence,
    provenance: edge.provenance
  };
}

function formatExpansionStep(step: ContextEdgePathStep): string {
  const edgeLabel = `${step.edgeKind}/${step.provenance}/${step.confidence}`;
  return step.traversalDirection === "forward"
    ? `${step.fromLabel} --${edgeLabel}--> ${step.toLabel}`
    : `${step.fromLabel} <--${edgeLabel}-- ${step.toLabel}`;
}

function formatMatchedEntity(entity: GraphEntity): string {
  return `${entity.name} (${entity.kind})`;
}

function trimToBudget(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }
  if (maxChars <= 3) {
    return content.slice(0, maxChars);
  }
  return `${content.slice(0, maxChars - 3).trimEnd()}...`.slice(0, maxChars);
}

function hasDeclaredTrustTier(document: Pick<GraphDocument, "metadata">): boolean {
  return typeof document.metadata?.declaredTrustTier === "string";
}

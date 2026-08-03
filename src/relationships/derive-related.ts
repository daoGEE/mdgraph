import { runDoctor } from "../analysis/doctor.js";
import type {
  GraphRepository,
  SemanticRelationshipChunk
} from "../db/repositories.js";
import { embeddingCapability } from "../semantic/provider-registry.js";
import type { GraphDocument, GraphEdge, MDGraphConfig } from "../types.js";
import { EDGE_WEIGHTS } from "../types.js";
import { stableId } from "../utils/id.js";

export const RELATED_TO_ALGORITHM_VERSION = "document-chunk-reciprocal-v1";
export const RELATED_TO_QUALITY_GATE = "semantic-relatedness-v1";
export const RELATED_TO_DEFAULT_THRESHOLD = 0.86;
export const RELATED_TO_MIN_THRESHOLD = 0.75;
export const RELATED_TO_DEFAULT_MAX_NEIGHBORS = 3;
export const RELATED_TO_DEFAULT_MIN_EVIDENCE = 2;
export const RELATED_TO_MAX_DOCUMENT_PAIRS = 250_000;
export const RELATED_TO_MAX_VECTOR_COMPARISONS = 2_000_000;
export const RELATED_TO_MAX_COMPONENT_COMPARISONS = 100_000_000;
export const RELATED_TO_MAX_CHUNKS_PER_DOCUMENT = 12;

export interface DeriveRelatedRelationshipsOptions {
  threshold?: number;
  maxNeighbors?: number;
  minEvidence?: number;
  dryRun?: boolean;
}

export interface DerivedRelationshipEvidence {
  fromChunkId: string;
  fromSectionId?: string;
  toChunkId: string;
  toSectionId?: string;
  similarity: number;
}

export interface DerivedRelationship {
  fromDocumentId: string;
  fromPath: string;
  toDocumentId: string;
  toPath: string;
  confidence: number;
  evidenceSections: DerivedRelationshipEvidence[];
}

export interface DerivedRelationshipReport {
  algorithmVersion: typeof RELATED_TO_ALGORITHM_VERSION;
  generatedAt: string;
  provider: string;
  model: string;
  dimensions: number;
  options: {
    threshold: number;
    maxNeighbors: number;
    minEvidence: number;
    dryRun: boolean;
  };
  qualityGate: {
    id: typeof RELATED_TO_QUALITY_GATE;
    passed: true;
    checks: {
      freshIndex: true;
      semanticModelProvider: true;
      completeVectorCoverage: true;
      thresholdFloor: true;
      multipleIndependentEvidenceSections: true;
      reciprocalTopK: true;
    };
  };
  corpus: {
    documents: number;
    eligibleDocuments: number;
    chunks: number;
    vectors: number;
    invalidVectors: number;
    sampledChunks: number;
    documentsWithSampledChunkTruncation: number;
    documentPairsEvaluated: number;
    centroidComponentComparisons: number;
    evidenceVectorComparisons: number;
    evidenceComponentComparisons: number;
  };
  relationships: DerivedRelationship[];
  relationshipPairs: number;
  directedEdges: number;
  mutation: {
    dryRun: boolean;
    removed: number;
    inserted: number;
  };
}

export type DerivedRelationshipErrorCode =
  | "embedding_disabled"
  | "provider_not_semantic"
  | "stale_index"
  | "incomplete_vector_coverage"
  | "invalid_options"
  | "corpus_too_large";

export class DerivedRelationshipError extends Error {
  readonly name = "DerivedRelationshipError";

  constructor(readonly code: DerivedRelationshipErrorCode, message: string) {
    super(message);
  }
}

interface DocumentVectors {
  document: GraphDocument;
  chunks: SemanticRelationshipChunk[];
  centroid: number[];
}

interface CandidateRelationship extends DerivedRelationship {
  key: string;
}

export async function deriveRelatedRelationships(
  repository: GraphRepository,
  projectRoot: string,
  config: MDGraphConfig,
  options: DeriveRelatedRelationshipsOptions = {}
): Promise<DerivedRelationshipReport> {
  const normalized = normalizeOptions(options);
  validateProvider(config);
  const doctor = await runDoctor(projectRoot, { applySchema: false });
  const parseFailures = doctor.warnings.filter((warning) => warning.code === "document.parse_failed");
  if (doctor.staleIndex.stale || parseFailures.length) {
    throw new DerivedRelationshipError(
      "stale_index",
      parseFailures.length
        ? `RELATED_TO derivation requires every indexed Markdown file to be readable; doctor reported ${parseFailures.length} parse failure(s).`
        : `RELATED_TO derivation requires a fresh index; ${doctor.staleIndex.recommendation}.`
    );
  }

  const counts = repository.counts();
  const corpus = repository.semanticRelationshipCorpus(
    config.embedding.provider,
    config.embedding.model,
    config.embedding.dimensions
  );
  if (corpus.invalidVectors > 0 || corpus.chunks.length !== counts.chunks || counts.vectors !== counts.chunks) {
    throw new DerivedRelationshipError(
      "incomplete_vector_coverage",
      `RELATED_TO derivation requires complete ${config.embedding.provider}/${config.embedding.model}/${config.embedding.dimensions} vector coverage; found ${corpus.chunks.length} valid matching vector(s) for ${counts.chunks} chunk(s), with ${corpus.invalidVectors} invalid vector(s). Run \`mdgraph index --semantic --full\`.`
    );
  }

  const grouped = groupDocumentVectors(corpus.chunks, normalized.minEvidence);
  const pairBudget = grouped.documents.length * (grouped.documents.length - 1) / 2;
  if (pairBudget > RELATED_TO_MAX_DOCUMENT_PAIRS) {
    throw new DerivedRelationshipError(
      "corpus_too_large",
      `RELATED_TO derivation would evaluate ${pairBudget} document pairs, above the ${RELATED_TO_MAX_DOCUMENT_PAIRS} safety limit.`
    );
  }
  const centroidComponentComparisons = pairBudget * config.embedding.dimensions;
  if (centroidComponentComparisons > RELATED_TO_MAX_COMPONENT_COMPARISONS) {
    throw new DerivedRelationshipError(
      "corpus_too_large",
      `RELATED_TO centroid evaluation would compare ${centroidComponentComparisons} vector components, above the ${RELATED_TO_MAX_COMPONENT_COMPARISONS} safety limit.`
    );
  }

  let documentPairsEvaluated = 0;
  let evidenceVectorComparisons = 0;
  const candidates: CandidateRelationship[] = [];
  const centroidFloor = Math.max(0, normalized.threshold - 0.12);
  for (let leftIndex = 0; leftIndex < grouped.documents.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < grouped.documents.length; rightIndex += 1) {
      documentPairsEvaluated += 1;
      const left = grouped.documents[leftIndex];
      const right = grouped.documents[rightIndex];
      if (cosine(left.centroid, right.centroid) < centroidFloor) {
        continue;
      }
      const comparisons = left.chunks.length * right.chunks.length;
      evidenceVectorComparisons += comparisons;
      if (evidenceVectorComparisons > RELATED_TO_MAX_VECTOR_COMPARISONS) {
        throw new DerivedRelationshipError(
          "corpus_too_large",
          `RELATED_TO evidence evaluation exceeds the ${RELATED_TO_MAX_VECTOR_COMPARISONS} vector-comparison safety limit; increase the threshold or derive on a smaller graph.`
        );
      }
      if (evidenceVectorComparisons * config.embedding.dimensions > RELATED_TO_MAX_COMPONENT_COMPARISONS) {
        throw new DerivedRelationshipError(
          "corpus_too_large",
          `RELATED_TO evidence evaluation exceeds the ${RELATED_TO_MAX_COMPONENT_COMPARISONS} vector-component safety limit; increase the threshold or derive on a smaller graph.`
        );
      }
      const evidenceSections = independentEvidence(left.chunks, right.chunks, normalized.threshold, normalized.minEvidence);
      if (evidenceSections.length < normalized.minEvidence) {
        continue;
      }
      const confidence = rounded(evidenceSections
        .slice(0, normalized.minEvidence)
        .reduce((total, evidence) => total + evidence.similarity, 0) / normalized.minEvidence);
      candidates.push({
        key: relationshipKey(left.document.id, right.document.id),
        fromDocumentId: left.document.id,
        fromPath: left.document.path,
        toDocumentId: right.document.id,
        toPath: right.document.path,
        confidence,
        evidenceSections
      });
    }
  }

  const relationships = reciprocalRelationships(candidates, normalized.maxNeighbors)
    .sort((left, right) => left.fromPath.localeCompare(right.fromPath) || left.toPath.localeCompare(right.toPath));
  const generatedAt = new Date().toISOString();
  const edges = relationships.flatMap((relationship) => relationshipEdges(
    relationship,
    config,
    normalized,
    generatedAt
  ));
  const mutation = normalized.dryRun
    ? { dryRun: true, removed: 0, inserted: 0 }
    : { dryRun: false, ...repository.replaceEmbeddingSimilarityEdges(edges) };

  return {
    algorithmVersion: RELATED_TO_ALGORITHM_VERSION,
    generatedAt,
    provider: config.embedding.provider,
    model: config.embedding.model,
    dimensions: config.embedding.dimensions,
    options: normalized,
    qualityGate: {
      id: RELATED_TO_QUALITY_GATE,
      passed: true,
      checks: {
        freshIndex: true,
        semanticModelProvider: true,
        completeVectorCoverage: true,
        thresholdFloor: true,
        multipleIndependentEvidenceSections: true,
        reciprocalTopK: true
      }
    },
    corpus: {
      documents: counts.documents,
      eligibleDocuments: grouped.documents.length,
      chunks: counts.chunks,
      vectors: counts.vectors,
      invalidVectors: corpus.invalidVectors,
      sampledChunks: grouped.sampledChunks,
      documentsWithSampledChunkTruncation: grouped.truncatedDocuments,
      documentPairsEvaluated,
      centroidComponentComparisons,
      evidenceVectorComparisons,
      evidenceComponentComparisons: evidenceVectorComparisons * config.embedding.dimensions
    },
    relationships: relationships.map(({ key: _key, ...relationship }) => relationship),
    relationshipPairs: relationships.length,
    directedEdges: edges.length,
    mutation
  };
}

function normalizeOptions(options: DeriveRelatedRelationshipsOptions): DerivedRelationshipReport["options"] {
  const threshold = options.threshold ?? RELATED_TO_DEFAULT_THRESHOLD;
  const maxNeighbors = options.maxNeighbors ?? RELATED_TO_DEFAULT_MAX_NEIGHBORS;
  const minEvidence = options.minEvidence ?? RELATED_TO_DEFAULT_MIN_EVIDENCE;
  if (!Number.isFinite(threshold) || threshold < RELATED_TO_MIN_THRESHOLD || threshold > 1) {
    throw new DerivedRelationshipError(
      "invalid_options",
      `RELATED_TO threshold must be between ${RELATED_TO_MIN_THRESHOLD} and 1.`
    );
  }
  if (!Number.isSafeInteger(maxNeighbors) || maxNeighbors < 1 || maxNeighbors > 10) {
    throw new DerivedRelationshipError("invalid_options", "RELATED_TO maxNeighbors must be an integer from 1 to 10.");
  }
  if (!Number.isSafeInteger(minEvidence) || minEvidence < 2 || minEvidence > 4) {
    throw new DerivedRelationshipError("invalid_options", "RELATED_TO minEvidence must be an integer from 2 to 4.");
  }
  return { threshold, maxNeighbors, minEvidence, dryRun: options.dryRun === true };
}

function validateProvider(config: MDGraphConfig): void {
  if (!config.embedding.enabled) {
    throw new DerivedRelationshipError(
      "embedding_disabled",
      "RELATED_TO derivation is disabled because embedding.enabled is false. Enable a semantic-model provider and rebuild vectors first."
    );
  }
  if (embeddingCapability(config.embedding.provider) !== "semantic-model") {
    throw new DerivedRelationshipError(
      "provider_not_semantic",
      `Embedding provider '${config.embedding.provider}' is not a semantic-model provider and cannot emit RELATED_TO.`
    );
  }
}

function groupDocumentVectors(
  chunks: SemanticRelationshipChunk[],
  minEvidence: number
): { documents: DocumentVectors[]; sampledChunks: number; truncatedDocuments: number } {
  const byDocument = new Map<string, SemanticRelationshipChunk[]>();
  for (const chunk of chunks) {
    const current = byDocument.get(chunk.document.id) ?? [];
    current.push(chunk);
    byDocument.set(chunk.document.id, current);
  }
  const documents: DocumentVectors[] = [];
  let sampledChunks = 0;
  let truncatedDocuments = 0;
  for (const documentChunks of byDocument.values()) {
    if (documentChunks.length < minEvidence) {
      continue;
    }
    const sampled = sampleEvenly(documentChunks, RELATED_TO_MAX_CHUNKS_PER_DOCUMENT);
    const centroid = normalizedCentroid(sampled.map((chunk) => chunk.vector));
    if (!centroid.length) {
      continue;
    }
    sampledChunks += sampled.length;
    truncatedDocuments += documentChunks.length > sampled.length ? 1 : 0;
    documents.push({ document: sampled[0].document, chunks: sampled, centroid });
  }
  documents.sort((left, right) => left.document.path.localeCompare(right.document.path));
  return { documents, sampledChunks, truncatedDocuments };
}

function sampleEvenly<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) {
    return items;
  }
  const indexes = new Set<number>();
  for (let index = 0; index < limit; index += 1) {
    indexes.add(Math.round(index * (items.length - 1) / (limit - 1)));
  }
  return [...indexes].sort((left, right) => left - right).map((index) => items[index]);
}

function independentEvidence(
  left: SemanticRelationshipChunk[],
  right: SemanticRelationshipChunk[],
  threshold: number,
  minEvidence: number
): DerivedRelationshipEvidence[] {
  const candidates: DerivedRelationshipEvidence[] = [];
  for (const from of left) {
    for (const to of right) {
      const similarity = rounded(cosine(from.vector, to.vector));
      if (similarity >= threshold) {
        candidates.push({
          fromChunkId: from.chunk.id,
          fromSectionId: from.section?.id,
          toChunkId: to.chunk.id,
          toSectionId: to.section?.id,
          similarity
        });
      }
    }
  }
  candidates.sort((first, second) => (
    second.similarity - first.similarity
    || first.fromChunkId.localeCompare(second.fromChunkId)
    || first.toChunkId.localeCompare(second.toChunkId)
  ));
  const usedFrom = new Set<string>();
  const usedTo = new Set<string>();
  const evidence: DerivedRelationshipEvidence[] = [];
  const maximumEvidence = Math.max(minEvidence, 4);
  for (const candidate of candidates) {
    if (usedFrom.has(candidate.fromChunkId) || usedTo.has(candidate.toChunkId)) {
      continue;
    }
    evidence.push(candidate);
    usedFrom.add(candidate.fromChunkId);
    usedTo.add(candidate.toChunkId);
    if (evidence.length >= maximumEvidence) {
      break;
    }
  }
  return evidence;
}

function reciprocalRelationships(candidates: CandidateRelationship[], maxNeighbors: number): CandidateRelationship[] {
  const byDocument = new Map<string, Array<{ key: string; otherPath: string; confidence: number }>>();
  for (const candidate of candidates) {
    pushNeighbor(byDocument, candidate.fromDocumentId, candidate.key, candidate.toPath, candidate.confidence);
    pushNeighbor(byDocument, candidate.toDocumentId, candidate.key, candidate.fromPath, candidate.confidence);
  }
  const selected = new Map<string, Set<string>>();
  for (const [documentId, neighbors] of byDocument) {
    neighbors.sort((left, right) => right.confidence - left.confidence || left.otherPath.localeCompare(right.otherPath));
    selected.set(documentId, new Set(neighbors.slice(0, maxNeighbors).map((neighbor) => neighbor.key)));
  }
  return candidates.filter((candidate) => (
    selected.get(candidate.fromDocumentId)?.has(candidate.key)
    && selected.get(candidate.toDocumentId)?.has(candidate.key)
  ));
}

function pushNeighbor(
  target: Map<string, Array<{ key: string; otherPath: string; confidence: number }>>,
  documentId: string,
  key: string,
  otherPath: string,
  confidence: number
): void {
  const neighbors = target.get(documentId) ?? [];
  neighbors.push({ key, otherPath, confidence });
  target.set(documentId, neighbors);
}

function relationshipEdges(
  relationship: CandidateRelationship,
  config: MDGraphConfig,
  options: DerivedRelationshipReport["options"],
  generatedAt: string
): GraphEdge[] {
  return [
    relationshipEdge(relationship, false, config, options, generatedAt),
    relationshipEdge(relationship, true, config, options, generatedAt)
  ];
}

function relationshipEdge(
  relationship: CandidateRelationship,
  reverse: boolean,
  config: MDGraphConfig,
  options: DerivedRelationshipReport["options"],
  generatedAt: string
): GraphEdge {
  const fromId = reverse ? relationship.toDocumentId : relationship.fromDocumentId;
  const toId = reverse ? relationship.fromDocumentId : relationship.toDocumentId;
  const evidenceSections = reverse
    ? relationship.evidenceSections.map((evidence) => ({
        fromChunkId: evidence.toChunkId,
        fromSectionId: evidence.toSectionId,
        toChunkId: evidence.fromChunkId,
        toSectionId: evidence.fromSectionId,
        similarity: evidence.similarity
      }))
    : relationship.evidenceSections;
  return {
    id: stableId("edge", `${fromId}:RELATED_TO:${toId}:embedding_similarity`),
    fromId,
    toId,
    kind: "RELATED_TO",
    weight: EDGE_WEIGHTS.RELATED_TO,
    confidence: relationship.confidence,
    provenance: "embedding_similarity",
    metadata: {
      provider: config.embedding.provider,
      model: config.embedding.model,
      dimensions: config.embedding.dimensions,
      algorithmVersion: RELATED_TO_ALGORITHM_VERSION,
      qualityGate: RELATED_TO_QUALITY_GATE,
      threshold: options.threshold,
      minEvidence: options.minEvidence,
      reciprocalTopK: options.maxNeighbors,
      symmetric: true,
      evidenceSections,
      generatedAt
    },
    createdAt: generatedAt
  };
}

function relationshipKey(leftId: string, rightId: string): string {
  return leftId < rightId ? `${leftId}\u0000${rightId}` : `${rightId}\u0000${leftId}`;
}

function normalizedCentroid(vectors: number[][]): number[] {
  if (!vectors.length) {
    return [];
  }
  const dimensions = vectors[0].length;
  const centroid = Array.from({ length: dimensions }, () => 0);
  for (const vector of vectors) {
    const normalized = normalizeVector(vector);
    if (!normalized.length) {
      continue;
    }
    for (let index = 0; index < dimensions; index += 1) {
      centroid[index] += normalized[index];
    }
  }
  return normalizeVector(centroid);
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
  return magnitude > 0 ? vector.map((value) => value / magnitude) : [];
}

function cosine(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) {
    return 0;
  }
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
  }
  return Math.max(-1, Math.min(1, dot));
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

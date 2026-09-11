import { createHash } from "node:crypto";
import { loadConfig } from "./config/load-config.js";
import { openDatabase } from "./db/connection.js";
import { GraphRepository, IndexGenerationConflict, type StatusCounts } from "./db/repositories.js";
import { buildGraphRecords } from "./extraction/graph-builder.js";
import { parseMarkdownDocument } from "./parser/markdown-parser.js";
import { scanMarkdownFiles } from "./scanner/file-scanner.js";
import { embedChunks } from "./semantic/embed-chunks.js";
import type { GraphRecordSet, MDGraphConfig } from "./types.js";
import { relativePathInsideRoot } from "./utils/path-safety.js";

export interface IndexResult {
  files: number;
  changed: number;
  deleted: number;
  unchanged: number;
  skipped: number;
  skippedFiles: Array<{ path: string; reason: string }>;
  mode: "full" | "incremental";
  counts: StatusCounts;
}

export interface IndexOptions {
  full?: boolean;
  semantic?: boolean;
}

export async function indexProject(projectRoot: string, options: IndexOptions = {}): Promise<IndexResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await indexProjectAttempt(projectRoot, options);
    } catch (error) {
      if (!(error instanceof IndexGenerationConflict) || attempt === 1) throw error;
    }
  }
  throw new Error("Unreachable index retry state.");
}

async function indexProjectAttempt(projectRoot: string, options: IndexOptions): Promise<IndexResult> {
  const config = effectiveConfig(loadConfig(projectRoot), options);
  const fingerprint = extractionFingerprint(config);
  // Capture generation before asynchronous scan/parse/embed work. The write CAS
  // below rejects this candidate if another index finishes while it is prepared.
  const preflightDb = openDatabase(projectRoot);
  let expectedGeneration: number;
  try {
    expectedGeneration = new GraphRepository(preflightDb).indexWriteState().generation;
  } finally {
    preflightDb.close();
  }
  const files = await scanMarkdownFiles(projectRoot, config);
  const { parsed, skippedFiles } = parseScannedFiles(projectRoot, files);
  const records = buildGraphRecords(parsed, config);
  const db = openDatabase(projectRoot);
  try {
    const repository = new GraphRepository(db);
    const existingCounts = repository.counts();
    const writeState = repository.indexWriteState();
    const requiresCompleteEmbedding = config.embedding.enabled && !hasMatchingVectorCoverage(repository, config, existingCounts);
    const vectorProfileChanged = existingCounts.vectors > 0 && requiresCompleteEmbedding;
    const requiresRebuild = options.full || existingCounts.documents === 0 || requiresCompleteEmbedding || writeState.extractionFingerprint !== fingerprint;
    // A parser failure is a non-destructive condition: retain that document's last
    // known graph until it can be parsed again, rather than turning a transient edit
    // into a deletion during a requested rebuild.
    if (requiresRebuild && skippedFiles.length === 0) {
      records.vectors = await vectorsForChunks(repository, records.chunks, config);
      if (!options.full && !vectorProfileChanged) {
        records.edges.push(...repository.preservedDerivedEdges(records));
      }
      repository.replaceAll(records, { expectedGeneration, extractionFingerprint: fingerprint });
      return {
        files: files.length,
        changed: parsed.length,
        deleted: 0,
        unchanged: 0,
        skipped: skippedFiles.length,
        skippedFiles,
        mode: "full",
        counts: repository.counts()
      };
    }

    const existing = repository.documentHashes();
    const currentPaths = new Set(files.map((file) => relativePathInsideRoot(projectRoot, file)).filter((value): value is string => Boolean(value)));
    const changedDocuments = parsed.filter((document) => existing.get(document.relativePath)?.hash !== document.hash);
    const deletedDocumentIds = [...existing.entries()]
      .filter(([documentPath]) => !currentPaths.has(documentPath))
      .map(([, document]) => document.id);
    if (changedDocuments.length || deletedDocumentIds.length) {
      const changedIds = new Set(changedDocuments.map((document) => document.id));
      const replacedDocumentIds = changedDocuments
        .map((document) => existing.get(document.relativePath)?.id)
        .filter((existingId): existingId is string => typeof existingId === "string" && !changedIds.has(existingId));
      const changedRecords = filterRecordsForDocuments(records, changedIds);
      changedRecords.vectors = await vectorsForChunks(repository, changedRecords.chunks, config);
      repository.replaceDocuments(
        changedRecords,
        [...changedIds],
        [...deletedDocumentIds, ...replacedDocumentIds],
        skippedFiles.length === 0 ? records : undefined,
        {
          expectedGeneration,
          // Do not mark a partial, parser-skipped candidate as a completed
          // extraction-config rebuild. The next successful scan must retry it.
          extractionFingerprint: requiresRebuild ? writeState.extractionFingerprint : fingerprint
        }
      );
    }

    return {
      files: files.length,
      changed: changedDocuments.length,
      deleted: deletedDocumentIds.length,
      unchanged: files.length - changedDocuments.length - skippedFiles.length,
      skipped: skippedFiles.length,
      skippedFiles,
      mode: "incremental",
      counts: repository.counts()
    };
  } finally {
    db.close();
  }
}

async function vectorsForChunks(repository: GraphRepository, chunks: GraphRecordSet["chunks"], config: MDGraphConfig) {
  if (!config.embedding.enabled) return [];
  const profile = { provider: config.embedding.provider, model: config.embedding.model, dimensions: config.embedding.dimensions };
  const reusable = repository.reusableVectors(chunks, profile);
  const present = new Set(reusable.map((vector) => vector.chunkId));
  const embedded = await embedChunks(chunks.filter((chunk) => !present.has(chunk.id)), config);
  return [...reusable, ...embedded];
}

function extractionFingerprint(config: MDGraphConfig): string {
  const extraction = {
    docs: config.docs,
    index: config.index,
    entities: {
      enabledKinds: [...config.entities.enabledKinds].sort(),
      stopEntities: [...config.entities.stopEntities].sort()
    }
  };
  return createHash("sha256").update(JSON.stringify(extraction)).digest("hex");
}

function hasMatchingVectorCoverage(repository: GraphRepository, config: MDGraphConfig, counts: StatusCounts): boolean {
  if (counts.vectors !== counts.chunks) {
    return false;
  }
  if (counts.chunks === 0) {
    return true;
  }
  return repository.storageDiagnostics().vectors.providers.some((provider) => (
    provider.provider === config.embedding.provider
    && provider.model === config.embedding.model
    && provider.dimensions === config.embedding.dimensions
    && provider.vectors === counts.chunks
  ));
}

function parseScannedFiles(projectRoot: string, files: string[]): {
  parsed: ReturnType<typeof parseMarkdownDocument>[];
  skippedFiles: IndexResult["skippedFiles"];
} {
  const parsed: ReturnType<typeof parseMarkdownDocument>[] = [];
  const skippedFiles: IndexResult["skippedFiles"] = [];
  for (const file of files) {
    try {
      parsed.push(parseMarkdownDocument(projectRoot, file));
    } catch (error) {
      skippedFiles.push({
        path: relativePathInsideRoot(projectRoot, file) ?? file,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return { parsed, skippedFiles };
}

function effectiveConfig(config: MDGraphConfig, options: IndexOptions): MDGraphConfig {
  if (options.semantic === undefined) {
    return config;
  }
  return {
    ...config,
    embedding: {
      ...config.embedding,
      enabled: options.semantic
    }
  };
}

function filterRecordsForDocuments(records: GraphRecordSet, documentIds: Set<string>): GraphRecordSet {
  const sectionIds = new Set(records.sections.filter((section) => documentIds.has(section.documentId)).map((section) => section.id));
  const chunkIds = new Set(records.chunks.filter((chunk) => documentIds.has(chunk.documentId)).map((chunk) => chunk.id));
  const ownedNodeIds = new Set<string>([...documentIds, ...sectionIds, ...chunkIds]);
  const changedEdges = records.edges.filter((edge) => ownedNodeIds.has(edge.fromId) || ownedNodeIds.has(edge.toId));
  const referencedEntityIds = new Set(changedEdges.flatMap((edge) => [edge.fromId, edge.toId]));

  return {
    documents: records.documents.filter((document) => documentIds.has(document.id)),
    sections: records.sections.filter((section) => sectionIds.has(section.id)),
    entities: records.entities.filter((entity) => referencedEntityIds.has(entity.id)),
    sourceRefs: records.sourceRefs.filter((sourceRef) => referencedEntityIds.has(sourceRef.id)),
    edges: changedEdges,
    chunks: records.chunks.filter((chunk) => chunkIds.has(chunk.id)),
    vectors: records.vectors.filter((vector) => chunkIds.has(vector.chunkId))
  };
}

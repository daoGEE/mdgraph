export { DEFAULT_CONFIG, configPath, databasePath, initConfig, loadConfig } from "./config/load-config.js";
export { DOCTOR_WARNING_CODES, runDoctor, formatDoctorReport } from "./analysis/doctor.js";
export { formatBenchmarkReport, generateBenchmarkReport, loadBenchmarkReport, parseAgentRunRecords } from "./benchmark/benchmark.js";
export { createGraphBundle, verifyGraphBundle, sourceSnapshot, hashCanonical, canonicalJson } from "./bundle/bundle.js";
export { openDatabase } from "./db/connection.js";
export { GraphRepository } from "./db/repositories.js";
export { generateGraphDiff, formatGraphDiff } from "./diff/graph-diff.js";
export { ALPHA_EVALUATION_CASES, CJK_EVALUATION_CASES, EVALUATION_QUERY_SET_NAMES, evaluateRetrieval, evaluateRetrievalAsync, evaluationCasesForQuerySet } from "./evaluation/retrieval-eval.js";
export { buildMermaidTraceExport, formatTraceMermaid } from "./export/diagram.js";
export { buildGraphJsonExport, formatGraphJsonVerification, graphJsonHash, readGraphJsonFile, stableGraphJson, verifyGraphJsonExport } from "./export/graphjson.js";
export { buildDocsSiteIndex, formatWikiLinkMarkdownIndex } from "./export/markdown-index.js";
export { buildSourceBridgeReport } from "./export/source-bridge.js";
export { buildGraphRecords } from "./extraction/graph-builder.js";
export { extractEntities } from "./extraction/entity-extractor.js";
export { indexProject } from "./indexer.js";
export { MCPServer, startStdioMcpServer } from "./mcp/server.js";
export { ToolHandler, tools as mcpTools } from "./mcp/tools.js";
export { parseMarkdownDocument } from "./parser/markdown-parser.js";
export {
  CONTEXT_PACKING_STRATEGIES,
  CONTEXT_PACKING_STRATEGY,
  DEFAULT_MMR_LAMBDA,
  buildContext,
  buildContextAsync
} from "./query/context-builder.js";
export type {
  ContextBuildOptions,
  ContextDebug,
  ContextPackingInfo,
  ContextPackingSelection,
  ContextPackingSimilarity,
  ContextPackingStrategy,
  ContextResult
} from "./query/context-builder.js";
export { explainSearchGraph, explainSearchGraphAsync, searchGraph, searchGraphAsync } from "./query/search.js";
export { traceNodes } from "./query/trace.js";
export { executeStructuredQuery, StructuredQueryExecutionError } from "./query/structured-query-executor.js";
export type { StructuredQueryExecutionStage, StructuredQueryItem, StructuredQueryResult } from "./query/structured-query-executor.js";
export {
  STRUCTURED_QUERY_DEFAULT_LIMIT,
  STRUCTURED_QUERY_HEALTH_VALUES,
  STRUCTURED_QUERY_MAX_LIMIT,
  StructuredQuerySyntaxError,
  formatStructuredQueryExpression,
  parseStructuredQuery,
  structuredQueryPredicates,
  structuredQueryUsesHealth,
  tokenizeStructuredQuery,
  validateStructuredQuery
} from "./query/structured-query.js";
export type {
  StructuredQueryAST,
  StructuredQueryExpression,
  StructuredQueryField,
  StructuredQueryHealth,
  StructuredQueryLogicalExpression,
  StructuredQueryNotExpression,
  StructuredQueryOperator,
  StructuredQueryPredicate,
  StructuredQuerySort,
  StructuredQuerySortDirection,
  StructuredQueryToken,
  StructuredQueryTokenKind
} from "./query/structured-query.js";
export {
  RELATED_TO_ALGORITHM_VERSION,
  RELATED_TO_DEFAULT_MAX_NEIGHBORS,
  RELATED_TO_DEFAULT_MIN_EVIDENCE,
  RELATED_TO_DEFAULT_THRESHOLD,
  RELATED_TO_MAX_CHUNKS_PER_DOCUMENT,
  RELATED_TO_MAX_COMPONENT_COMPARISONS,
  RELATED_TO_MAX_DOCUMENT_PAIRS,
  RELATED_TO_MAX_VECTOR_COMPARISONS,
  RELATED_TO_MIN_THRESHOLD,
  RELATED_TO_QUALITY_GATE,
  DerivedRelationshipError,
  deriveRelatedRelationships
} from "./relationships/derive-related.js";
export type {
  DeriveRelatedRelationshipsOptions,
  DerivedRelationship,
  DerivedRelationshipErrorCode,
  DerivedRelationshipEvidence,
  DerivedRelationshipReport
} from "./relationships/derive-related.js";
export { generateReport, formatReport } from "./reporting/report.js";
export { scanMarkdownFiles } from "./scanner/file-scanner.js";
export { embedTextLocal } from "./semantic/local-embedding.js";
export { createEmbeddingProvider, embeddingCapability, isSupportedEmbeddingProvider, registerEmbeddingProvider, supportsSynchronousEmbeddingProvider } from "./semantic/provider-registry.js";
export type { EmbeddingProviderFactory } from "./semantic/provider-registry.js";
export { EmbeddingProviderError, embeddingDiagnostic, validateEmbeddingVector } from "./semantic/provider.js";
export type { EmbeddingCapability, EmbeddingDiagnostic, EmbeddingProvider, EmbeddingProviderAvailability, EmbeddingProviderErrorCode, EmbeddingRuntimeStatus } from "./semantic/provider.js";
export { semanticStatusReport, semanticStatusReportAsync } from "./semantic/status.js";
export { decodeFloat32Vector, encodeFloat32Vector } from "./semantic/vector-codec.js";
export { watchProject } from "./watcher/file-watcher.js";
export type { WatchHandle, WatchProjectOptions } from "./watcher/file-watcher.js";
export type { WatchFailureCode, WatchFailurePhase, WatchHealthError, WatchHealthSnapshot, WatchHealthState } from "./watcher/watch-health.js";
export * from "./types.js";

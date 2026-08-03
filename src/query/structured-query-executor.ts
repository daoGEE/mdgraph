import { runDoctor, type DoctorReport } from "../analysis/doctor.js";
import type { GraphRepository } from "../db/repositories.js";
import type { GraphDocument } from "../types.js";
import {
  formatStructuredQueryExpression,
  parseStructuredQuery,
  structuredQueryPredicates,
  structuredQueryUsesHealth,
  validateStructuredQuery,
  type StructuredQueryAST,
  type StructuredQueryExpression,
  type StructuredQueryHealth,
  type StructuredQueryPredicate,
  type StructuredQuerySort
} from "./structured-query.js";

export type StructuredQueryExecutionStage = "document" | "metadata" | "graph" | "doctor";

export interface StructuredQueryItem {
  document: GraphDocument;
  reason: string;
  predicateFields: string[];
  provenance: StructuredQueryExecutionStage[];
}

export interface StructuredQueryResult {
  query: string;
  ast: StructuredQueryAST;
  execution: {
    strategy: "parameterized-sql" | "parameterized-hybrid-doctor";
    stages: StructuredQueryExecutionStage[];
    parameterCount: number;
    doctorHealthEvaluated: boolean;
  };
  total: number;
  returned: number;
  truncated: boolean;
  items: StructuredQueryItem[];
}

export class StructuredQueryExecutionError extends Error {
  readonly name = "StructuredQueryExecutionError";
}

export async function executeStructuredQuery(
  repository: GraphRepository,
  projectRoot: string,
  query: string,
  ast = parseStructuredQuery(query)
): Promise<StructuredQueryResult> {
  validateStructuredQuery(ast);
  const predicates = structuredQueryPredicates(ast.expression);
  const predicateFields = [...new Set(predicates.map((predicate) => predicate.field))];
  const stages = stagesForPredicates(predicates);
  const reason = `matched structured query: ${formatStructuredQueryExpression(ast.expression)}`;

  if (!structuredQueryUsesHealth(ast.expression)) {
    const rows = repository.queryStructuredDocuments(ast);
    const items = rows.documents.map((document) => ({ document, reason, predicateFields, provenance: stages }));
    return {
      query,
      ast,
      execution: {
        strategy: "parameterized-sql",
        stages,
        parameterCount: rows.parameterCount,
        doctorHealthEvaluated: false
      },
      total: rows.total,
      returned: items.length,
      truncated: rows.truncated,
      items
    };
  }

  const doctor = await runDoctor(projectRoot, { applySchema: false });
  if (doctor.staleIndex.stale) {
    throw new StructuredQueryExecutionError(
      "Health predicates require a fresh index; run `mdgraph index` before retrying the structured query."
    );
  }
  const predicateMatches = new Map<string, Set<string>>();
  let parameterCount = 0;
  for (const predicate of uniquePredicates(predicates.filter((predicate) => predicate.field !== "health"))) {
    const matched = repository.documentIdsMatchingStructuredPredicate(predicate);
    predicateMatches.set(predicateKey(predicate), matched.documentIds);
    parameterCount += matched.parameterCount;
  }
  const health = healthDocumentPaths(doctor);
  const matchedDocuments = repository.allDocuments()
    .filter((document) => evaluateExpression(ast.expression, document, predicateMatches, health))
    .sort(documentComparator(ast.orderBy));
  const documents = matchedDocuments.slice(0, ast.limit);
  const items = documents.map((document) => ({ document, reason, predicateFields, provenance: stages }));
  return {
    query,
    ast,
    execution: {
      strategy: "parameterized-hybrid-doctor",
      stages,
      parameterCount,
      doctorHealthEvaluated: true
    },
    total: matchedDocuments.length,
    returned: items.length,
    truncated: matchedDocuments.length > ast.limit,
    items
  };
}

function evaluateExpression(
  expression: StructuredQueryExpression,
  document: GraphDocument,
  predicateMatches: Map<string, Set<string>>,
  health: Map<StructuredQueryHealth, Set<string>>
): boolean {
  if (expression.kind === "predicate") {
    if (expression.field === "health") {
      const matches = health.get(expression.value as StructuredQueryHealth)?.has(document.path) ?? false;
      return expression.operator === "!=" ? !matches : matches;
    }
    return predicateMatches.get(predicateKey(expression))?.has(document.id) ?? false;
  }
  if (expression.kind === "not") {
    return !evaluateExpression(expression.expression, document, predicateMatches, health);
  }
  if (expression.kind === "and") {
    return evaluateExpression(expression.left, document, predicateMatches, health)
      && evaluateExpression(expression.right, document, predicateMatches, health);
  }
  return evaluateExpression(expression.left, document, predicateMatches, health)
    || evaluateExpression(expression.right, document, predicateMatches, health);
}

function healthDocumentPaths(report: DoctorReport): Map<StructuredQueryHealth, Set<string>> {
  return new Map<StructuredQueryHealth, Set<string>>([
    ["dead_link", new Set(report.deadLinks.map((issue) => issue.documentPath))],
    ["orphan", new Set(report.orphanDocs.map((document) => document.path))],
    ["stale_source_ref", new Set(report.staleSourceRefs.flatMap((issue) => issue.documentPaths))],
    ["missing_definition", new Set(report.missingDefinitions.map((issue) => issue.document.path))],
    ["weakly_linked", new Set(report.weaklyLinkedDocs.map((issue) => issue.document.path))],
    ["possible_contradiction", new Set(report.possibleContradictions.flatMap((issue) => issue.documents.map((document) => document.path)))],
    ["content_risk", new Set(report.contentRisks.map((issue) => issue.documentPath))]
  ]);
}

function documentComparator(orderBy: StructuredQuerySort[]): (left: GraphDocument, right: GraphDocument) => number {
  const sorts = orderBy.length ? orderBy : [{ field: "path" as const, direction: "asc" as const }];
  return (left, right) => {
    for (const sort of sorts) {
      const comparison = documentSortValue(left, sort.field).localeCompare(documentSortValue(right, sort.field));
      if (comparison !== 0) {
        return sort.direction === "desc" ? -comparison : comparison;
      }
    }
    return left.path.localeCompare(right.path);
  };
}

function documentSortValue(document: GraphDocument, field: StructuredQuerySort["field"]): string {
  switch (field) {
    case "path": return document.path;
    case "title": return document.title;
    case "type": return document.type;
    case "status": return document.status;
    case "trust": return document.trustTier;
    case "updated": return document.updatedAt ?? "";
    case "indexed": return document.indexedAt;
  }
}

function stagesForPredicates(predicates: StructuredQueryPredicate[]): StructuredQueryExecutionStage[] {
  const stages = new Set<StructuredQueryExecutionStage>();
  for (const predicate of predicates) {
    if (predicate.field === "tag") {
      stages.add("metadata");
    } else if (predicate.field === "edge" || predicate.field.startsWith("edge.")) {
      stages.add("graph");
    } else if (predicate.field === "health") {
      stages.add("doctor");
    } else {
      stages.add("document");
    }
  }
  const order: StructuredQueryExecutionStage[] = ["document", "metadata", "graph", "doctor"];
  return order.filter((stage) => stages.has(stage));
}

function uniquePredicates(predicates: StructuredQueryPredicate[]): StructuredQueryPredicate[] {
  return [...new Map(predicates.map((predicate) => [predicateKey(predicate), predicate])).values()];
}

function predicateKey(predicate: StructuredQueryPredicate): string {
  return `${predicate.field}\u0000${predicate.operator}\u0000${predicate.value}`;
}

import { GraphRepository, type NodeRecord } from "../db/repositories.js";
import type {
  EdgeKind,
  GraphDocument,
  GraphEdge,
  GraphEntity,
  GraphSection,
  Provenance,
  SourceRef
} from "../types.js";

export const DEFAULT_KNOWLEDGE_CARD_LIMITS = {
  definitions: 8,
  sourceRefs: 8,
  relatedDocuments: 8,
  evidence: 12,
  maxChars: 4_000
} as const;

export type KnowledgeCardNodeKind = Exclude<NodeRecord["kind"], "chunk">;

export interface CardReference {
  nodeId: string;
  kind: KnowledgeCardNodeKind;
  label: string;
  path?: string;
  anchor?: string;
  lines?: { start: number; end: number };
  edgeKind?: EdgeKind;
  provenance?: Provenance;
  confidence?: number;
}

export interface CardSourceReference {
  nodeId: string;
  path: string;
  edgeKind: Extract<EdgeKind, "IMPLEMENTS" | "REFERENCES_SOURCE">;
  provenance: Provenance;
  confidence: number;
}

export interface CardEvidence {
  edgeId: string;
  fromId: string;
  fromLabel: string;
  toId: string;
  toLabel: string;
  edgeKind: EdgeKind;
  provenance: Provenance;
  confidence: number;
}

export interface KnowledgeCard {
  nodeId: string;
  kind: KnowledgeCardNodeKind;
  label: string;
  summary: string;
  definitions: CardReference[];
  sourceRefs: CardSourceReference[];
  relatedDocuments: CardReference[];
  evidence: CardEvidence[];
  truncated?: {
    definitions?: number;
    sourceRefs?: number;
    relatedDocuments?: number;
    evidence?: number;
  };
}

export interface KnowledgeCardOptions {
  maxDefinitions?: number;
  maxSourceRefs?: number;
  maxRelatedDocuments?: number;
  maxEvidence?: number;
  maxChars?: number;
}

interface CardLimits {
  definitions: number;
  sourceRefs: number;
  relatedDocuments: number;
  evidence: number;
  maxChars: number;
}

interface CardFacts {
  definitions: CardReference[];
  sourceRefs: CardSourceReference[];
  relatedDocuments: CardReference[];
  evidence: CardEvidence[];
}

export interface KnowledgeCardBuilder {
  build(nodeOrId: NodeRecord | string): KnowledgeCard | undefined;
}

export function createKnowledgeCardBuilder(
  repository: GraphRepository,
  options: KnowledgeCardOptions = {}
): KnowledgeCardBuilder {
  const limits = knowledgeCardLimits(options);
  const documents = repository.allDocuments();
  const sections = repository.allSections();
  const entities = repository.allEntities();
  const sourceRefs = repository.allSourceRefs();
  const edges = repository.allEdges().sort(compareEdges);
  const nodes = structuralNodeMap(documents, sections, entities, sourceRefs);
  const sectionsByDocument = groupSectionsByDocument(sections);
  const edgesByNode = groupEdgesByNode(edges);

  return {
    build(nodeOrId) {
      const node = typeof nodeOrId === "string" ? nodes.get(nodeOrId) : nodeOrId;
      if (!node || node.kind === "chunk") {
        return undefined;
      }

      const scopeIds = cardScopeIds(node, sectionsByDocument);
      const directEdges = edgesForScope(scopeIds, edgesByNode);
      const facts = collectCardFacts(
        node,
        directEdges,
        nodes,
        sectionsByDocument,
        edgesByNode
      );
      const summary = cardSummary(node, facts, nodes);
      return fitCardToLimits({
        nodeId: node.id,
        kind: node.kind,
        label: node.label,
        summary,
        definitions: facts.definitions,
        sourceRefs: facts.sourceRefs,
        relatedDocuments: facts.relatedDocuments,
        evidence: facts.evidence
      }, limits);
    }
  };
}

export function buildKnowledgeCard(
  repository: GraphRepository,
  nodeOrId: NodeRecord | string,
  options: KnowledgeCardOptions = {}
): KnowledgeCard | undefined {
  return createKnowledgeCardBuilder(repository, options).build(nodeOrId);
}

export function formatKnowledgeCard(card: KnowledgeCard): string {
  const sections = [
    "Knowledge Card (experimental)",
    `Summary: ${card.summary}`,
    formatReferenceList("Definitions", card.definitions),
    formatSourceReferenceList(card.sourceRefs),
    formatReferenceList("Related documents", card.relatedDocuments),
    formatEvidenceList(card.evidence)
  ];
  const truncated = card.truncated
    ? Object.entries(card.truncated).map(([field, count]) => `${field}: ${count}`).join(", ")
    : "";
  if (truncated) {
    sections.push(`Truncated: ${truncated}`);
  }
  return sections.join("\n\n");
}

function collectCardFacts(
  node: Extract<NodeRecord, { kind: KnowledgeCardNodeKind }> | NodeRecord,
  directEdges: GraphEdge[],
  nodes: Map<string, NodeRecord>,
  sectionsByDocument: Map<string, GraphSection[]>,
  edgesByNode: Map<string, GraphEdge[]>
): CardFacts {
  const definitions = definitionReferences(node, directEdges, nodes);
  const relatedDocumentIds = relatedDocumentsForNode(node, directEdges, nodes);
  const sourceRefEdges = node.kind === "entity"
    ? sourceRefEdgesForDocuments(relatedDocumentIds, sectionsByDocument, edgesByNode, nodes)
    : directEdges;
  const sourceReferences = sourceReferencesFromEdges(sourceRefEdges, nodes);
  const relatedDocuments = [...relatedDocumentIds]
    .flatMap((documentId) => {
      const document = nodes.get(documentId);
      return document?.kind === "document" ? [referenceForNode(document)] : [];
    })
    .sort(compareReferences);
  const evidence = directEdges
    .flatMap((edge) => evidenceForEdge(edge, nodes))
    .sort(compareEvidence);
  return {
    definitions: dedupeReferences(definitions).sort(compareReferences),
    sourceRefs: dedupeSourceReferences(sourceReferences).sort(compareSourceReferences),
    relatedDocuments,
    evidence
  };
}

function definitionReferences(node: NodeRecord, edges: GraphEdge[], nodes: Map<string, NodeRecord>): CardReference[] {
  const definitions: CardReference[] = [];
  for (const edge of edges) {
    if (edge.kind !== "DEFINES") {
      continue;
    }
    if (node.kind === "entity") {
      if (edge.toId !== node.id) {
        continue;
      }
      const location = nodes.get(edge.fromId);
      if (location && location.kind !== "chunk") {
        definitions.push(referenceForNode(location, edge, nodes));
      }
      continue;
    }
    const entity = nodes.get(edge.toId);
    if (entity?.kind === "entity") {
      definitions.push(referenceForNode(entity, edge));
    }
  }
  return definitions;
}

function relatedDocumentsForNode(
  node: NodeRecord,
  edges: GraphEdge[],
  nodes: Map<string, NodeRecord>
): Set<string> {
  const documentIds = new Set<string>();
  if (node.kind === "section") {
    documentIds.add((node.data as GraphSection).documentId);
  }
  for (const edge of edges) {
    for (const endpointId of [edge.fromId, edge.toId]) {
      const documentId = owningDocumentId(nodes.get(endpointId));
      if (documentId) {
        documentIds.add(documentId);
      }
    }
  }
  if (node.kind === "document") {
    documentIds.delete(node.id);
  }
  return documentIds;
}

function sourceRefEdgesForDocuments(
  documentIds: Set<string>,
  sectionsByDocument: Map<string, GraphSection[]>,
  edgesByNode: Map<string, GraphEdge[]>,
  nodes: Map<string, NodeRecord>
): GraphEdge[] {
  const scopeIds = [...documentIds].flatMap((documentId) => [
    documentId,
    ...(sectionsByDocument.get(documentId) ?? []).map((section) => section.id)
  ]);
  return edgesForScope(scopeIds, edgesByNode).filter((edge) => {
    if (edge.kind !== "IMPLEMENTS" && edge.kind !== "REFERENCES_SOURCE") {
      return false;
    }
    return nodes.get(edge.fromId)?.kind === "source_ref" || nodes.get(edge.toId)?.kind === "source_ref";
  });
}

function sourceReferencesFromEdges(edges: GraphEdge[], nodes: Map<string, NodeRecord>): CardSourceReference[] {
  const references: CardSourceReference[] = [];
  for (const edge of edges) {
    if (edge.kind !== "IMPLEMENTS" && edge.kind !== "REFERENCES_SOURCE") {
      continue;
    }
    const sourceNode = nodes.get(edge.fromId)?.kind === "source_ref"
      ? nodes.get(edge.fromId)
      : nodes.get(edge.toId)?.kind === "source_ref"
        ? nodes.get(edge.toId)
        : undefined;
    if (sourceNode?.kind !== "source_ref") {
      continue;
    }
    references.push({
      nodeId: sourceNode.id,
      path: (sourceNode.data as SourceRef).path,
      edgeKind: edge.kind,
      provenance: edge.provenance,
      confidence: edge.confidence
    });
  }
  return references;
}

function cardSummary(node: NodeRecord, facts: CardFacts, nodes: Map<string, NodeRecord>): string {
  switch (node.kind) {
    case "document": {
      const document = node.data as GraphDocument;
      return `${document.title} is a ${document.type} document at ${document.path} with status ${document.status} and trust tier ${document.trustTier}; the current graph exposes ${facts.definitions.length} definition(s), ${facts.sourceRefs.length} source reference(s), and ${facts.relatedDocuments.length} directly related document(s).`;
    }
    case "section": {
      const section = node.data as GraphSection;
      const document = nodes.get(section.documentId);
      const path = document?.kind === "document" ? (document.data as GraphDocument).path : section.documentId;
      return `${section.heading} is the section ${path}#${section.anchor} at lines ${section.startLine}-${section.endLine}; the current graph exposes ${facts.definitions.length} definition(s), ${facts.sourceRefs.length} source reference(s), and ${facts.evidence.length} evidence edge(s).`;
    }
    case "entity": {
      const entity = node.data as GraphEntity;
      return `${entity.name} is a ${entity.kind} entity with ${facts.definitions.length} definition location(s), ${facts.relatedDocuments.length} related document(s), and ${facts.sourceRefs.length} source reference(s) in the current graph.`;
    }
    case "source_ref": {
      const sourceRef = node.data as SourceRef;
      return `${sourceRef.path} is a project source reference linked from ${facts.relatedDocuments.length} document(s) by ${facts.evidence.length} evidence edge(s) in the current graph.`;
    }
    default:
      return `${node.label} is represented by the current graph.`;
  }
}

function fitCardToLimits(card: KnowledgeCard, limits: CardLimits): KnowledgeCard {
  const minimum = minimumCard(card);
  const minimumChars = serializedCardLength(minimum);
  if (minimumChars > limits.maxChars) {
    throw new RangeError(`Knowledge card budget ${limits.maxChars} is below the minimum representable card size ${minimumChars}.`);
  }
  const truncated: NonNullable<KnowledgeCard["truncated"]> = {};
  const fitted: KnowledgeCard = {
    ...card,
    definitions: takeWithOmitted(card.definitions, limits.definitions, "definitions", truncated),
    sourceRefs: takeWithOmitted(card.sourceRefs, limits.sourceRefs, "sourceRefs", truncated),
    relatedDocuments: takeWithOmitted(card.relatedDocuments, limits.relatedDocuments, "relatedDocuments", truncated),
    evidence: takeWithOmitted(card.evidence, limits.evidence, "evidence", truncated)
  };
  if (Object.keys(truncated).length) {
    fitted.truncated = truncated;
  }

  const removalOrder: Array<keyof Pick<KnowledgeCard, "evidence" | "relatedDocuments" | "sourceRefs" | "definitions">> = [
    "evidence",
    "relatedDocuments",
    "sourceRefs",
    "definitions"
  ];
  while (serializedCardLength(fitted) > limits.maxChars) {
    const field = removalOrder.find((candidate) => fitted[candidate].length > 0);
    if (!field) {
      break;
    }
    fitted[field].pop();
    fitted.truncated ??= {};
    fitted.truncated[field] = (fitted.truncated[field] ?? 0) + 1;
  }
  return fitCardTextToBudget(fitted, limits.maxChars);
}

function minimumCard(card: KnowledgeCard): KnowledgeCard {
  const minimum: KnowledgeCard = {
    nodeId: card.nodeId,
    kind: card.kind,
    label: "",
    summary: "",
    definitions: [],
    sourceRefs: [],
    relatedDocuments: [],
    evidence: []
  };
  if (card.truncated) {
    minimum.truncated = card.truncated;
  }
  return minimum;
}

function serializedCardLength(card: KnowledgeCard): number {
  return JSON.stringify(card).length;
}

function fitCardTextToBudget(card: KnowledgeCard, maxChars: number): KnowledgeCard {
  const minimumChars = serializedCardLength(minimumCard(card));
  if (minimumChars > maxChars) {
    throw new RangeError(`Knowledge card budget ${maxChars} cannot represent required truncation metadata (${minimumChars} characters).`);
  }
  if (serializedCardLength(card) <= maxChars) {
    return card;
  }
  const markerCard = {
    ...card,
    label: card.label ? "…" : "",
    summary: card.summary ? "…" : ""
  };
  if (serializedCardLength(markerCard) > maxChars) {
    throw new RangeError(`Knowledge card budget ${maxChars} cannot represent required truncated text markers.`);
  }
  const withLabel = {
    ...markerCard,
    label: longestPrefixWithinCardBudget(markerCard, "label", card.label, maxChars)
  };
  const fitted = {
    ...withLabel,
    summary: longestPrefixWithinCardBudget(withLabel, "summary", card.summary, maxChars)
  };
  return fitted;
}

function longestPrefixWithinCardBudget(
  card: KnowledgeCard,
  field: "label" | "summary",
  value: string,
  maxChars: number
): string {
  if (serializedCardLength({ ...card, [field]: value }) <= maxChars) {
    return value;
  }
  const codePoints = Array.from(value);
  const marker = "…";
  if (serializedCardLength({ ...card, [field]: marker }) > maxChars) {
    throw new RangeError(`Knowledge card budget ${maxChars} cannot represent a truncated ${field} marker.`);
  }
  let lower = 0;
  let upper = codePoints.length;
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    const candidate = { ...card, [field]: `${codePoints.slice(0, middle).join("")}${marker}` };
    if (serializedCardLength(candidate) <= maxChars) {
      lower = middle;
    } else {
      upper = middle - 1;
    }
  }
  return `${codePoints.slice(0, lower).join("")}${marker}`;
}

function takeWithOmitted<T>(
  values: T[],
  limit: number,
  field: keyof NonNullable<KnowledgeCard["truncated"]>,
  truncated: NonNullable<KnowledgeCard["truncated"]>
): T[] {
  const selected = values.slice(0, limit);
  const omitted = values.length - selected.length;
  if (omitted > 0) {
    truncated[field] = omitted;
  }
  return selected;
}

function knowledgeCardLimits(options: KnowledgeCardOptions): CardLimits {
  return {
    definitions: nonNegativeIntegerOr(options.maxDefinitions, DEFAULT_KNOWLEDGE_CARD_LIMITS.definitions),
    sourceRefs: nonNegativeIntegerOr(options.maxSourceRefs, DEFAULT_KNOWLEDGE_CARD_LIMITS.sourceRefs),
    relatedDocuments: nonNegativeIntegerOr(options.maxRelatedDocuments, DEFAULT_KNOWLEDGE_CARD_LIMITS.relatedDocuments),
    evidence: nonNegativeIntegerOr(options.maxEvidence, DEFAULT_KNOWLEDGE_CARD_LIMITS.evidence),
    maxChars: positiveIntegerOr(options.maxChars, DEFAULT_KNOWLEDGE_CARD_LIMITS.maxChars)
  };
}

function structuralNodeMap(
  documents: GraphDocument[],
  sections: GraphSection[],
  entities: GraphEntity[],
  sourceRefs: SourceRef[]
): Map<string, NodeRecord> {
  const nodes = new Map<string, NodeRecord>();
  for (const document of documents) {
    nodes.set(document.id, { id: document.id, label: document.title, kind: "document", data: document });
  }
  for (const section of sections) {
    nodes.set(section.id, { id: section.id, label: section.heading, kind: "section", data: section });
  }
  for (const entity of entities) {
    nodes.set(entity.id, { id: entity.id, label: entity.name, kind: "entity", data: entity });
  }
  for (const sourceRef of sourceRefs) {
    nodes.set(sourceRef.id, { id: sourceRef.id, label: sourceRef.path, kind: "source_ref", data: sourceRef });
  }
  return nodes;
}

function groupSectionsByDocument(sections: GraphSection[]): Map<string, GraphSection[]> {
  const grouped = new Map<string, GraphSection[]>();
  for (const section of sections) {
    grouped.set(section.documentId, [...(grouped.get(section.documentId) ?? []), section]);
  }
  return grouped;
}

function groupEdgesByNode(edges: GraphEdge[]): Map<string, GraphEdge[]> {
  const grouped = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    grouped.set(edge.fromId, [...(grouped.get(edge.fromId) ?? []), edge]);
    if (edge.toId !== edge.fromId) {
      grouped.set(edge.toId, [...(grouped.get(edge.toId) ?? []), edge]);
    }
  }
  return grouped;
}

function cardScopeIds(node: NodeRecord, sectionsByDocument: Map<string, GraphSection[]>): string[] {
  if (node.kind === "document") {
    return [node.id, ...(sectionsByDocument.get(node.id) ?? []).map((section) => section.id)];
  }
  if (node.kind === "section") {
    return [node.id, (node.data as GraphSection).documentId];
  }
  return [node.id];
}

function edgesForScope(scopeIds: string[], edgesByNode: Map<string, GraphEdge[]>): GraphEdge[] {
  const edges = new Map<string, GraphEdge>();
  for (const nodeId of scopeIds) {
    for (const edge of edgesByNode.get(nodeId) ?? []) {
      edges.set(edge.id, edge);
    }
  }
  return [...edges.values()].sort(compareEdges);
}

function owningDocumentId(node: NodeRecord | undefined): string | undefined {
  if (node?.kind === "document") {
    return node.id;
  }
  if (node?.kind === "section") {
    return (node.data as GraphSection).documentId;
  }
  return undefined;
}

function referenceForNode(
  node: Exclude<NodeRecord, { kind: "chunk" }> | NodeRecord,
  edge?: GraphEdge,
  nodes?: Map<string, NodeRecord>
): CardReference {
  const reference: CardReference = {
    nodeId: node.id,
    kind: node.kind as KnowledgeCardNodeKind,
    label: node.label
  };
  if (node.kind === "document") {
    reference.path = (node.data as GraphDocument).path;
  } else if (node.kind === "section") {
    const section = node.data as GraphSection;
    const document = nodes?.get(section.documentId);
    if (document?.kind === "document") {
      reference.path = (document.data as GraphDocument).path;
    }
    reference.anchor = section.anchor;
    reference.lines = { start: section.startLine, end: section.endLine };
  } else if (node.kind === "source_ref") {
    reference.path = (node.data as SourceRef).path;
  }
  if (edge) {
    reference.edgeKind = edge.kind;
    reference.provenance = edge.provenance;
    reference.confidence = edge.confidence;
  }
  return reference;
}

function evidenceForEdge(edge: GraphEdge, nodes: Map<string, NodeRecord>): CardEvidence[] {
  const from = nodes.get(edge.fromId);
  const to = nodes.get(edge.toId);
  if (!from || !to || from.kind === "chunk" || to.kind === "chunk") {
    return [];
  }
  return [{
    edgeId: edge.id,
    fromId: edge.fromId,
    fromLabel: from.label,
    toId: edge.toId,
    toLabel: to.label,
    edgeKind: edge.kind,
    provenance: edge.provenance,
    confidence: edge.confidence
  }];
}

function dedupeReferences(references: CardReference[]): CardReference[] {
  const deduped = new Map<string, CardReference>();
  for (const reference of references.sort(compareReferences)) {
    if (!deduped.has(reference.nodeId)) {
      deduped.set(reference.nodeId, reference);
    }
  }
  return [...deduped.values()];
}

function dedupeSourceReferences(references: CardSourceReference[]): CardSourceReference[] {
  const deduped = new Map<string, CardSourceReference>();
  for (const reference of references.sort(compareSourceReferences)) {
    const key = `${reference.nodeId}:${reference.edgeKind}`;
    if (!deduped.has(key)) {
      deduped.set(key, reference);
    }
  }
  return [...deduped.values()];
}

function compareReferences(left: CardReference, right: CardReference): number {
  return (left.path ?? "").localeCompare(right.path ?? "")
    || (left.lines?.start ?? 0) - (right.lines?.start ?? 0)
    || left.label.localeCompare(right.label)
    || left.nodeId.localeCompare(right.nodeId);
}

function compareSourceReferences(left: CardSourceReference, right: CardSourceReference): number {
  return left.path.localeCompare(right.path)
    || left.edgeKind.localeCompare(right.edgeKind)
    || left.provenance.localeCompare(right.provenance)
    || left.nodeId.localeCompare(right.nodeId);
}

function compareEvidence(left: CardEvidence, right: CardEvidence): number {
  return edgeKindPriority(left.edgeKind) - edgeKindPriority(right.edgeKind)
    || left.fromLabel.localeCompare(right.fromLabel)
    || left.toLabel.localeCompare(right.toLabel)
    || left.edgeId.localeCompare(right.edgeId);
}

function compareEdges(left: GraphEdge, right: GraphEdge): number {
  return edgeKindPriority(left.kind) - edgeKindPriority(right.kind)
    || left.fromId.localeCompare(right.fromId)
    || left.toId.localeCompare(right.toId)
    || left.kind.localeCompare(right.kind)
    || left.provenance.localeCompare(right.provenance)
    || left.id.localeCompare(right.id);
}

function edgeKindPriority(kind: EdgeKind): number {
  const order: EdgeKind[] = [
    "DEFINES",
    "IMPLEMENTS",
    "REFERENCES_SOURCE",
    "DEPENDS_ON",
    "SUPERSEDES",
    "DEPRECATED_BY",
    "LINKS_TO",
    "REFERENCES",
    "RELATED_TO",
    "SAME_AS",
    "CONTRADICTS",
    "CONTAINS"
  ];
  return order.indexOf(kind);
}

function formatReferenceList(title: string, references: CardReference[]): string {
  if (!references.length) {
    return `${title}: none`;
  }
  const lines = references.map((reference) => {
    const location = reference.path
      ? ` (${reference.path})`
      : reference.anchor
        ? ` (#${reference.anchor}${reference.lines ? `:${reference.lines.start}-${reference.lines.end}` : ""})`
        : "";
    const edge = reference.edgeKind
      ? ` [${reference.edgeKind}/${reference.provenance}, confidence ${reference.confidence}]`
      : "";
    return `- ${reference.label}${location}${edge} [${reference.nodeId}]`;
  });
  return `${title}:\n${lines.join("\n")}`;
}

function formatSourceReferenceList(references: CardSourceReference[]): string {
  if (!references.length) {
    return "Source refs: none";
  }
  return `Source refs:\n${references.map((reference) => `- ${reference.path} [${reference.edgeKind}/${reference.provenance}, confidence ${reference.confidence}; ${reference.nodeId}]`).join("\n")}`;
}

function formatEvidenceList(evidence: CardEvidence[]): string {
  if (!evidence.length) {
    return "Evidence: none";
  }
  return `Evidence:\n${evidence.map((item) => `- ${item.fromLabel} --${item.edgeKind}/${item.provenance}, confidence ${item.confidence}--> ${item.toLabel} [${item.edgeId}]`).join("\n")}`;
}

function nonNegativeIntegerOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function positiveIntegerOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

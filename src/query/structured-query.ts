import { EDGE_WEIGHTS, type EdgeKind } from "../types.js";

export const STRUCTURED_QUERY_DEFAULT_LIMIT = 50;
export const STRUCTURED_QUERY_MAX_LIMIT = 500;
const STRUCTURED_QUERY_MAX_LENGTH = 10_000;
const STRUCTURED_QUERY_MAX_TOKENS = 256;
const STRUCTURED_QUERY_MAX_DEPTH = 24;
const STRUCTURED_QUERY_MAX_PREDICATES = 64;
const DOCUMENT_KINDS = new Set(["spec", "design", "adr", "api", "runbook", "incident", "meeting", "guide", "memory", "other"]);
const TRUST_TIERS = new Set(["authored", "generated", "validated", "external", "untrusted"]);

export const STRUCTURED_QUERY_HEALTH_VALUES = [
  "dead_link",
  "orphan",
  "stale_source_ref",
  "missing_definition",
  "weakly_linked",
  "possible_contradiction",
  "content_risk"
] as const;

export type StructuredQueryHealth = typeof STRUCTURED_QUERY_HEALTH_VALUES[number];
export type StructuredQueryOperator = "=" | "!=" | "~" | "!~" | "<" | "<=" | ">" | ">=";
export type StructuredQuerySortDirection = "asc" | "desc";
export type StructuredQueryField =
  | "type"
  | "status"
  | "trust"
  | "path"
  | "title"
  | "updated"
  | "indexed"
  | "tag"
  | "edge"
  | `edge.${EdgeKind}`
  | "health";

export interface StructuredQueryPredicate {
  kind: "predicate";
  field: StructuredQueryField;
  operator: StructuredQueryOperator;
  value: string;
}

export interface StructuredQueryLogicalExpression {
  kind: "and" | "or";
  left: StructuredQueryExpression;
  right: StructuredQueryExpression;
}

export interface StructuredQueryNotExpression {
  kind: "not";
  expression: StructuredQueryExpression;
}

export type StructuredQueryExpression = StructuredQueryPredicate | StructuredQueryLogicalExpression | StructuredQueryNotExpression;

export interface StructuredQuerySort {
  field: Extract<StructuredQueryField, "path" | "title" | "type" | "status" | "trust" | "updated" | "indexed">;
  direction: StructuredQuerySortDirection;
}

export interface StructuredQueryAST {
  expression: StructuredQueryExpression;
  orderBy: StructuredQuerySort[];
  limit: number;
}

export type StructuredQueryTokenKind = "word" | "string" | "operator" | "left_paren" | "right_paren" | "comma";

export interface StructuredQueryToken {
  kind: StructuredQueryTokenKind;
  value: string;
  offset: number;
}

export class StructuredQuerySyntaxError extends Error {
  readonly name = "StructuredQuerySyntaxError";

  constructor(message: string, readonly offset: number) {
    super(`${message} at offset ${offset}`);
  }
}

export function tokenizeStructuredQuery(input: string): StructuredQueryToken[] {
  if (input.length > STRUCTURED_QUERY_MAX_LENGTH) {
    throw new StructuredQuerySyntaxError(`Query exceeds ${STRUCTURED_QUERY_MAX_LENGTH} characters`, STRUCTURED_QUERY_MAX_LENGTH);
  }
  const tokens: StructuredQueryToken[] = [];
  let offset = 0;
  while (offset < input.length) {
    const character = input[offset];
    if (/\s/u.test(character)) {
      offset += 1;
      continue;
    }
    if (character === "(") {
      tokens.push({ kind: "left_paren", value: character, offset });
      offset += 1;
      continue;
    }
    if (character === ")") {
      tokens.push({ kind: "right_paren", value: character, offset });
      offset += 1;
      continue;
    }
    if (character === ",") {
      tokens.push({ kind: "comma", value: character, offset });
      offset += 1;
      continue;
    }
    if (character === "\"" || character === "'") {
      const token = quotedToken(input, offset, character);
      tokens.push(token.token);
      offset = token.nextOffset;
      continue;
    }
    const twoCharacters = input.slice(offset, offset + 2);
    if (twoCharacters === "!=" || twoCharacters === "!~" || twoCharacters === "<=" || twoCharacters === ">=") {
      tokens.push({ kind: "operator", value: twoCharacters, offset });
      offset += 2;
      continue;
    }
    if (character === "=" || character === ":" || character === "~" || character === "<" || character === ">") {
      tokens.push({ kind: "operator", value: character === ":" ? "=" : character, offset });
      offset += 1;
      continue;
    }

    const start = offset;
    while (offset < input.length && !/[\s(),=!~<>:'"]/u.test(input[offset])) {
      offset += 1;
    }
    if (offset === start) {
      throw new StructuredQuerySyntaxError(`Unexpected character '${character}'`, offset);
    }
    tokens.push({ kind: "word", value: input.slice(start, offset), offset: start });
    if (tokens.length > STRUCTURED_QUERY_MAX_TOKENS) {
      throw new StructuredQuerySyntaxError(`Query exceeds ${STRUCTURED_QUERY_MAX_TOKENS} tokens`, offset);
    }
  }
  if (tokens.length > STRUCTURED_QUERY_MAX_TOKENS) {
    throw new StructuredQuerySyntaxError(`Query exceeds ${STRUCTURED_QUERY_MAX_TOKENS} tokens`, input.length);
  }
  return tokens;
}

export function parseStructuredQuery(input: string): StructuredQueryAST {
  const parser = new StructuredQueryParser(tokenizeStructuredQuery(input));
  const ast = parser.parse();
  validateStructuredQuery(ast);
  return ast;
}

export function validateStructuredQuery(ast: StructuredQueryAST): void {
  let predicates = 0;
  visitStructuredExpression(ast.expression, (predicate) => {
    predicates += 1;
    if (predicates > STRUCTURED_QUERY_MAX_PREDICATES) {
      throw new StructuredQuerySyntaxError(`Query exceeds ${STRUCTURED_QUERY_MAX_PREDICATES} predicates`, 0);
    }
    validatePredicate(predicate);
  });
  if (!Number.isSafeInteger(ast.limit) || ast.limit <= 0 || ast.limit > STRUCTURED_QUERY_MAX_LIMIT) {
    throw new StructuredQuerySyntaxError(`LIMIT must be between 1 and ${STRUCTURED_QUERY_MAX_LIMIT}`, 0);
  }
  if (ast.orderBy.length > 3) {
    throw new StructuredQuerySyntaxError("ORDER BY supports at most 3 fields", 0);
  }
}

export function structuredQueryUsesHealth(expression: StructuredQueryExpression): boolean {
  let usesHealth = false;
  visitStructuredExpression(expression, (predicate) => {
    usesHealth ||= predicate.field === "health";
  });
  return usesHealth;
}

export function structuredQueryPredicates(expression: StructuredQueryExpression): StructuredQueryPredicate[] {
  const predicates: StructuredQueryPredicate[] = [];
  visitStructuredExpression(expression, (predicate) => predicates.push(predicate));
  return predicates;
}

export function formatStructuredQueryExpression(expression: StructuredQueryExpression): string {
  switch (expression.kind) {
    case "predicate":
      return `${expression.field} ${expression.operator} ${JSON.stringify(expression.value)}`;
    case "not":
      return `NOT (${formatStructuredQueryExpression(expression.expression)})`;
    case "and":
    case "or":
      return `(${formatStructuredQueryExpression(expression.left)} ${expression.kind.toUpperCase()} ${formatStructuredQueryExpression(expression.right)})`;
  }
}

function quotedToken(input: string, start: number, quote: string): { token: StructuredQueryToken; nextOffset: number } {
  let value = "";
  let offset = start + 1;
  while (offset < input.length) {
    const character = input[offset];
    if (character === quote) {
      return { token: { kind: "string", value, offset: start }, nextOffset: offset + 1 };
    }
    if (character === "\\") {
      const escaped = input[offset + 1];
      if (escaped === undefined) {
        break;
      }
      const escapes: Record<string, string> = { n: "\n", r: "\r", t: "\t", "\\": "\\", "\"": "\"", "'": "'" };
      value += escapes[escaped] ?? escaped;
      offset += 2;
      continue;
    }
    value += character;
    offset += 1;
  }
  throw new StructuredQuerySyntaxError("Unterminated quoted string", start);
}

class StructuredQueryParser {
  private index = 0;
  private depth = 0;

  constructor(private readonly tokens: StructuredQueryToken[]) {}

  parse(): StructuredQueryAST {
    if (!this.tokens.length) {
      throw new StructuredQuerySyntaxError("Query is empty", 0);
    }
    const expression = this.parseOr();
    const orderBy = this.consumeKeyword("ORDER") ? this.parseOrderBy() : [];
    const limit = this.consumeKeyword("LIMIT") ? this.parseLimit() : STRUCTURED_QUERY_DEFAULT_LIMIT;
    const remaining = this.peek();
    if (remaining) {
      throw new StructuredQuerySyntaxError(`Unexpected token '${remaining.value}'`, remaining.offset);
    }
    return { expression, orderBy, limit };
  }

  private parseOr(): StructuredQueryExpression {
    let expression = this.parseAnd();
    while (this.consumeKeyword("OR")) {
      expression = { kind: "or", left: expression, right: this.parseAnd() };
    }
    return expression;
  }

  private parseAnd(): StructuredQueryExpression {
    let expression = this.parseUnary();
    while (this.consumeKeyword("AND")) {
      expression = { kind: "and", left: expression, right: this.parseUnary() };
    }
    return expression;
  }

  private parseUnary(): StructuredQueryExpression {
    if (this.consumeKeyword("NOT")) {
      this.depth += 1;
      if (this.depth > STRUCTURED_QUERY_MAX_DEPTH) {
        throw new StructuredQuerySyntaxError(`Query nesting exceeds ${STRUCTURED_QUERY_MAX_DEPTH}`, this.peek()?.offset ?? this.endOffset());
      }
      const expression = this.parseUnary();
      this.depth -= 1;
      return { kind: "not", expression };
    }
    if (this.peek()?.kind === "left_paren") {
      const opening = this.take()!;
      this.depth += 1;
      if (this.depth > STRUCTURED_QUERY_MAX_DEPTH) {
        throw new StructuredQuerySyntaxError(`Query nesting exceeds ${STRUCTURED_QUERY_MAX_DEPTH}`, opening.offset);
      }
      const expression = this.parseOr();
      const closing = this.take();
      if (closing?.kind !== "right_paren") {
        throw new StructuredQuerySyntaxError("Expected ')'", closing?.offset ?? opening.offset);
      }
      this.depth -= 1;
      return expression;
    }
    return this.parsePredicate();
  }

  private parsePredicate(): StructuredQueryPredicate {
    const fieldToken = this.take();
    if (fieldToken?.kind !== "word") {
      throw new StructuredQuerySyntaxError("Expected a query field", fieldToken?.offset ?? this.endOffset());
    }
    const operatorToken = this.take();
    if (operatorToken?.kind !== "operator") {
      throw new StructuredQuerySyntaxError(`Expected an operator after '${fieldToken.value}'`, operatorToken?.offset ?? this.endOffset());
    }
    const valueToken = this.take();
    if (!valueToken || (valueToken.kind !== "word" && valueToken.kind !== "string")) {
      throw new StructuredQuerySyntaxError(`Expected a value after '${operatorToken.value}'`, valueToken?.offset ?? this.endOffset());
    }
    const field = normalizeField(fieldToken.value, fieldToken.offset);
    return {
      kind: "predicate",
      field,
      operator: operatorToken.value as StructuredQueryOperator,
      value: normalizePredicateValue(field, valueToken.value)
    };
  }

  private parseOrderBy(): StructuredQuerySort[] {
    const by = this.take();
    if (!isKeyword(by, "BY")) {
      throw new StructuredQuerySyntaxError("Expected BY after ORDER", by?.offset ?? this.endOffset());
    }
    const orderBy: StructuredQuerySort[] = [];
    while (true) {
      const fieldToken = this.take();
      if (fieldToken?.kind !== "word") {
        throw new StructuredQuerySyntaxError("Expected an ORDER BY field", fieldToken?.offset ?? this.endOffset());
      }
      const field = normalizeField(fieldToken.value, fieldToken.offset);
      if (!isSortField(field)) {
        throw new StructuredQuerySyntaxError(`Field '${field}' cannot be sorted`, fieldToken.offset);
      }
      const directionToken = this.peek();
      const direction = isKeyword(directionToken, "ASC") || isKeyword(directionToken, "DESC")
        ? this.take()!.value.toLowerCase() as StructuredQuerySortDirection
        : "asc";
      orderBy.push({ field, direction });
      if (this.peek()?.kind !== "comma") {
        break;
      }
      this.take();
    }
    return orderBy;
  }

  private parseLimit(): number {
    const token = this.take();
    if (token?.kind !== "word" || !/^\d+$/u.test(token.value)) {
      throw new StructuredQuerySyntaxError("Expected a positive integer after LIMIT", token?.offset ?? this.endOffset());
    }
    return Number(token.value);
  }

  private consumeKeyword(keyword: string): boolean {
    if (!isKeyword(this.peek(), keyword)) {
      return false;
    }
    this.index += 1;
    return true;
  }

  private peek(): StructuredQueryToken | undefined {
    return this.tokens[this.index];
  }

  private take(): StructuredQueryToken | undefined {
    const token = this.peek();
    this.index += token ? 1 : 0;
    return token;
  }

  private endOffset(): number {
    const last = this.tokens.at(-1);
    return last ? last.offset + last.value.length : 0;
  }
}

function validatePredicate(predicate: StructuredQueryPredicate): void {
  if (!predicate.value || predicate.value.length > 1_000) {
    throw new StructuredQuerySyntaxError("Predicate values must contain 1 to 1000 characters", 0);
  }
  const allowed = allowedOperators(predicate.field);
  if (!allowed.has(predicate.operator)) {
    throw new StructuredQuerySyntaxError(`Operator '${predicate.operator}' is not valid for '${predicate.field}'`, 0);
  }
  if ((predicate.field === "updated" || predicate.field === "indexed") && !validDateValue(predicate.value)) {
    throw new StructuredQuerySyntaxError(`Field '${predicate.field}' requires YYYY-MM-DD or an ISO timestamp`, 0);
  }
  if (predicate.field === "type" && !DOCUMENT_KINDS.has(predicate.value)) {
    throw new StructuredQuerySyntaxError(`Unknown document type '${predicate.value}'`, 0);
  }
  if (predicate.field === "trust" && !TRUST_TIERS.has(predicate.value)) {
    throw new StructuredQuerySyntaxError(`Unknown trust tier '${predicate.value}'`, 0);
  }
  if (predicate.field === "edge" && !edgeKind(predicate.value)) {
    throw new StructuredQuerySyntaxError(`Unknown edge kind '${predicate.value}'`, 0);
  }
  if (predicate.field === "health" && !STRUCTURED_QUERY_HEALTH_VALUES.includes(predicate.value.toLowerCase() as StructuredQueryHealth)) {
    throw new StructuredQuerySyntaxError(`Unknown health value '${predicate.value}'`, 0);
  }
}

function normalizePredicateValue(field: StructuredQueryField, value: string): string {
  if (field === "edge") {
    return value.toUpperCase();
  }
  if (field === "health" || field === "type" || field === "trust") {
    return value.toLowerCase();
  }
  return value;
}

function normalizeField(value: string, offset: number): StructuredQueryField {
  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, StructuredQueryField> = {
    type: "type",
    status: "status",
    trust: "trust",
    trust_tier: "trust",
    path: "path",
    title: "title",
    updated: "updated",
    updated_at: "updated",
    indexed: "indexed",
    indexed_at: "indexed",
    tag: "tag",
    tags: "tag",
    edge: "edge",
    health: "health"
  };
  if (aliases[normalized]) {
    return aliases[normalized];
  }
  if (normalized.startsWith("edge.")) {
    const kind = normalized.slice("edge.".length).toUpperCase();
    if (edgeKind(kind)) {
      return `edge.${kind}`;
    }
  }
  throw new StructuredQuerySyntaxError(`Unknown query field '${value}'`, offset);
}

function edgeKind(value: string): value is EdgeKind {
  return Object.prototype.hasOwnProperty.call(EDGE_WEIGHTS, value.toUpperCase());
}

function allowedOperators(field: StructuredQueryField): Set<StructuredQueryOperator> {
  if (field === "updated" || field === "indexed") {
    return new Set(["=", "!=", "<", "<=", ">", ">="]);
  }
  if (field === "edge" || field === "health") {
    return new Set(["=", "!="]);
  }
  return new Set(["=", "!=", "~", "!~"]);
}

function validDateValue(value: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
  return !Number.isNaN(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/u.test(value);
}

function isSortField(field: StructuredQueryField): field is StructuredQuerySort["field"] {
  return field === "path" || field === "title" || field === "type" || field === "status"
    || field === "trust" || field === "updated" || field === "indexed";
}

function isKeyword(token: StructuredQueryToken | undefined, keyword: string): boolean {
  return token?.kind === "word" && token.value.toUpperCase() === keyword;
}

function visitStructuredExpression(
  expression: StructuredQueryExpression,
  visit: (predicate: StructuredQueryPredicate) => void
): void {
  if (expression.kind === "predicate") {
    visit(expression);
    return;
  }
  if (expression.kind === "not") {
    visitStructuredExpression(expression.expression, visit);
    return;
  }
  visitStructuredExpression(expression.left, visit);
  visitStructuredExpression(expression.right, visit);
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { DEFAULT_CONFIG } from "../config/load-config.js";
import { extractEntities } from "../extraction/entity-extractor.js";
import { parseMarkdownDocument } from "../parser/markdown-parser.js";
import type { EntityKind } from "../types.js";
import { normalizeEntityName } from "../utils/text.js";

export const ENTITY_EXTRACTION_EVALUATION_VERSION = 1;

export const ENTITY_EXTRACTION_GATES = {
  minimumPrecision: 0.9,
  minimumRecall: 0.8,
  minimumCjkRecall: 0.8
} as const;

export interface EntityExtractionExpectedEntity {
  name: string;
  kind: EntityKind;
  language: "latin" | "cjk";
}

export interface EntityExtractionEvaluationReport {
  evaluationVersion: typeof ENTITY_EXTRACTION_EVALUATION_VERSION;
  expected: EntityExtractionExpectedEntity[];
  extracted: Array<{ name: string; kind: EntityKind }>;
  truePositives: Array<{ name: string; kind: EntityKind }>;
  falsePositives: Array<{ name: string; kind: EntityKind }>;
  falseNegatives: EntityExtractionExpectedEntity[];
  expectedNoise: string[];
  leakedNoise: string[];
  precision: number;
  recall: number;
  cjkRecall: number;
  elapsedMs: number;
}

export const ENTITY_EXTRACTION_EXPECTED: EntityExtractionExpectedEntity[] = [
  { name: "AuthCoordinator", kind: "symbol", language: "latin" },
  { name: "AuthService", kind: "symbol", language: "latin" },
  { name: "GET /api/auth/login", kind: "api_route", language: "latin" },
  { name: "JWT_SECRET", kind: "config_key", language: "latin" },
  { name: "src/auth/session.ts", kind: "file_path", language: "latin" },
  { name: "RedisTimeoutError", kind: "error_code", language: "latin" },
  { name: "loadSession()", kind: "symbol", language: "latin" },
  { name: "SessionRepository", kind: "symbol", language: "latin" },
  { name: "AuthAdapter", kind: "symbol", language: "latin" },
  { name: "rotateToken()", kind: "symbol", language: "latin" },
  { name: "登录服务", kind: "symbol", language: "cjk" },
  { name: "POST /接口/登录", kind: "api_route", language: "cjk" },
  { name: "登录.认证.重试", kind: "config_key", language: "cjk" },
  { name: "验证登录()", kind: "symbol", language: "cjk" },
  { name: "認証を確認()", kind: "symbol", language: "cjk" },
  { name: "验证会话()", kind: "symbol", language: "cjk" }
];

export const ENTITY_EXTRACTION_NOISE = [
  "/auth/session.ts",
  "Design",
  "Do",
  "Fall",
  "GET",
  "Include",
  "Note",
  "Prefer",
  "Reason",
  "Should",
  "Start",
  "The",
  "Use",
  "When"
] as const;

export function runEntityExtractionEvaluation(): EntityExtractionEvaluationReport {
  const started = performance.now();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-entity-extraction-"));
  try {
    const target = path.join(root, "docs", "entity-evaluation.md");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, evaluationDocument(), "utf8");

    const entities = extractEntities(parseMarkdownDocument(root, target), DEFAULT_CONFIG);
    const extracted = uniqueEntities(entities.map(({ name, kind }) => ({ name, kind })));
    const expectedByKey = new Map(ENTITY_EXTRACTION_EXPECTED.map((entity) => [entityKey(entity), entity]));
    const extractedByKey = new Map(extracted.map((entity) => [entityKey(entity), entity]));
    const truePositives = extracted.filter((entity) => expectedByKey.has(entityKey(entity)));
    const falsePositives = extracted.filter((entity) => !expectedByKey.has(entityKey(entity)));
    const falseNegatives = ENTITY_EXTRACTION_EXPECTED.filter((entity) => !extractedByKey.has(entityKey(entity)));
    const extractedNames = new Set(extracted.map((entity) => normalizeEntityName(entity.name)));
    const cjkExpected = ENTITY_EXTRACTION_EXPECTED.filter((entity) => entity.language === "cjk");

    return {
      evaluationVersion: ENTITY_EXTRACTION_EVALUATION_VERSION,
      expected: ENTITY_EXTRACTION_EXPECTED,
      extracted,
      truePositives,
      falsePositives,
      falseNegatives,
      expectedNoise: [...ENTITY_EXTRACTION_NOISE],
      leakedNoise: ENTITY_EXTRACTION_NOISE.filter((name) => extractedNames.has(normalizeEntityName(name))),
      precision: ratio(truePositives.length, extracted.length),
      recall: ratio(truePositives.length, ENTITY_EXTRACTION_EXPECTED.length),
      cjkRecall: ratio(
        cjkExpected.filter((entity) => extractedByKey.has(entityKey(entity))).length,
        cjkExpected.length
      ),
      elapsedMs: Number((performance.now() - started).toFixed(2))
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function evaluationDocument(): string {
  return [
    "---",
    "title: Entity Extraction Evaluation",
    "defines: [AuthCoordinator, 登录服务]",
    "---",
    "# Entity Extraction Evaluation",
    "",
    "Ordinary prose says The, When, Note, Design, and Should without declaring symbols.",
    "",
    "## Runtime Signals",
    "",
    "Use `AuthService`, `GET /api/auth/login`, `JWT_SECRET`, `src/auth/session.ts`, `RedisTimeoutError`, and `loadSession()`.",
    "CJK code references `登录服务`, `POST /接口/登录`, `登录.认证.重试`, `验证登录()`, and `認証を確認()`.",
    "",
    "```ts",
    "Do Prefer Use Fall Include Start Reason",
    "class SessionRepository {}",
    "interface AuthAdapter {}",
    "function rotateToken() {}",
    "function 验证会话() {}",
    "```",
    ""
  ].join("\n");
}

function uniqueEntities(values: Array<{ name: string; kind: EntityKind }>): Array<{ name: string; kind: EntityKind }> {
  return [...new Map(values.map((entity) => [entityKey(entity), entity])).values()]
    .sort((left, right) => entityKey(left).localeCompare(entityKey(right)));
}

function entityKey(entity: Pick<EntityExtractionExpectedEntity, "name" | "kind">): string {
  return `${entity.kind}:${normalizeEntityName(entity.name)}`;
}

function ratio(numerator: number, denominator: number): number {
  return denominator ? Number((numerator / denominator).toFixed(4)) : 0;
}

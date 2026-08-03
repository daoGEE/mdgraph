import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { DEFAULT_CONFIG } from "../config/load-config.js";
import { openDatabase } from "../db/connection.js";
import { GraphRepository } from "../db/repositories.js";
import { indexProject } from "../indexer.js";
import { buildContext } from "../query/context-builder.js";
import { searchGraph } from "../query/search.js";
import type { MDGraphConfig } from "../types.js";

export const HISTORICAL_BASELINE_VERSION = 1;

export interface SynonymRetrievalBaselineCase {
  id: string;
  query: string;
  expectedDocument: string;
  title: string;
  content: string;
}

export interface WatcherFailureBaselineCase {
  code: "ENOSPC" | "EMFILE" | "EACCES" | "INDEX_ERROR";
  phase: "startup" | "runtime" | "indexing";
  expectedFuturePolicy: "fatal" | "degraded";
  reason: string;
}

export interface HistoricalBaselineReport {
  baselineVersion: typeof HISTORICAL_BASELINE_VERSION;
  runtime: {
    nodeVersion: string;
    platform: NodeJS.Platform;
    architecture: string;
  };
  semantic: {
    provider: "local-hash";
    dimensions: number;
    cases: Array<{
      id: string;
      query: string;
      expectedDocument: string;
      keywordRank: number | null;
      localHashRank: number | null;
    }>;
    keywordRecallAt5: number;
    localHashRecallAt5: number;
    elapsedMs: number;
  };
  entities: {
    expected: string[];
    extracted: string[];
    truePositives: string[];
    falsePositives: string[];
    falseNegatives: string[];
    precision: number;
    recall: number;
    elapsedMs: number;
  };
  context: {
    packingStrategy: "mmr-style-document-round-robin";
    itemCount: number;
    uniqueDocuments: number;
    diversityRatio: number;
    averagePairwiseJaccard: number;
    maximumPairwiseJaccard: number;
    nearDuplicatePairs: number;
    elapsedMs: number;
  };
  watch: {
    cases: WatcherFailureBaselineCase[];
    currentPolicy: {
      errorSignal: "onError_callback";
      persistentHealth: false;
      fatalRuntimeErrors: false;
      pollingFallback: false;
    };
  };
}

export const SYNONYM_RETRIEVAL_BASELINE_CASES: SynonymRetrievalBaselineCase[] = [
  {
    id: "synonym-authentication",
    query: "authentication login",
    expectedDocument: "docs/identity-verification.md",
    title: "Identity Verification",
    content: "Credential validation checks secret material before granting a user session."
  },
  {
    id: "synonym-cache-retry",
    query: "redis timeout retry",
    expectedDocument: "docs/cache-recovery.md",
    title: "Cache Recovery",
    content: "A transient datastore delay triggers another attempt with bounded backoff."
  },
  {
    id: "synonym-rollback",
    query: "rollback failed deploy",
    expectedDocument: "docs/release-reversal.md",
    title: "Release Reversal",
    content: "Restore the previous release when production health deteriorates after rollout."
  },
  {
    id: "synonym-key-rotation",
    query: "renew jwt secret",
    expectedDocument: "docs/signing-credential-lifecycle.md",
    title: "Signing Credential Lifecycle",
    content: "Replace token signing credentials on a regular schedule and retire old key material."
  }
];

export const ENTITY_EXTRACTION_BASELINE_EXPECTED = [
  "AuthCoordinator",
  "AuthService",
  "GET /api/auth/login",
  "JWT_SECRET",
  "RedisTimeoutError",
  "SessionRepository",
  "loadSession()",
  "rotateToken()",
  "src/auth/session.ts"
] as const;

export const ENTITY_EXTRACTION_BASELINE_FALSE_POSITIVES = [
  "/auth/session.ts",
  "Do",
  "Fall",
  "GET",
  "Include",
  "Prefer",
  "Reason",
  "Start",
  "Use"
] as const;

export const WATCHER_FAILURE_BASELINE_CASES: WatcherFailureBaselineCase[] = [
  {
    code: "ENOSPC",
    phase: "startup",
    expectedFuturePolicy: "fatal",
    reason: "The operating-system watch limit prevents complete watcher registration."
  },
  {
    code: "ENOSPC",
    phase: "runtime",
    expectedFuturePolicy: "degraded",
    reason: "A running watcher may no longer cover the full project after resource exhaustion."
  },
  {
    code: "EMFILE",
    phase: "runtime",
    expectedFuturePolicy: "degraded",
    reason: "File-descriptor exhaustion makes subsequent watch coverage unreliable."
  },
  {
    code: "EACCES",
    phase: "startup",
    expectedFuturePolicy: "fatal",
    reason: "Unreadable configured paths make the initial watch set incomplete."
  },
  {
    code: "INDEX_ERROR",
    phase: "indexing",
    expectedFuturePolicy: "degraded",
    reason: "An indexing failure must remain visible until a later successful reindex."
  }
];

export async function runHistoricalBaseline(): Promise<HistoricalBaselineReport> {
  const [semantic, entities, context] = await Promise.all([
    measureSemanticBaseline(),
    measureEntityBaseline(),
    measureContextBaseline()
  ]);

  return {
    baselineVersion: HISTORICAL_BASELINE_VERSION,
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch
    },
    semantic,
    entities,
    context,
    watch: {
      cases: WATCHER_FAILURE_BASELINE_CASES,
      currentPolicy: {
        errorSignal: "onError_callback",
        persistentHealth: false,
        fatalRuntimeErrors: false,
        pollingFallback: false
      }
    }
  };
}

async function measureSemanticBaseline(): Promise<HistoricalBaselineReport["semantic"]> {
  const started = performance.now();
  const root = createTempProject("mdgraph-historical-semantic-");
  try {
    for (const item of SYNONYM_RETRIEVAL_BASELINE_CASES) {
      writeMarkdown(root, item.expectedDocument, item.title, item.content);
    }
    await indexProject(root, { full: true, semantic: true });

    const repository = new GraphRepository(openDatabase(root));
    try {
      const config: MDGraphConfig = {
        ...DEFAULT_CONFIG,
        embedding: { ...DEFAULT_CONFIG.embedding, enabled: true }
      };
      const cases = SYNONYM_RETRIEVAL_BASELINE_CASES.map((item) => {
        const keyword = searchGraph(repository, config, item.query, 5, { queryMode: "keyword" });
        const localHash = searchGraph(repository, config, item.query, 5, { queryMode: "semantic" });
        return {
          id: item.id,
          query: item.query,
          expectedDocument: item.expectedDocument,
          keywordRank: resultRank(keyword, item.expectedDocument),
          localHashRank: resultRank(localHash, item.expectedDocument)
        };
      });
      return {
        provider: "local-hash",
        dimensions: config.embedding.dimensions,
        cases,
        keywordRecallAt5: recallAt5(cases.map((item) => item.keywordRank)),
        localHashRecallAt5: recallAt5(cases.map((item) => item.localHashRank)),
        elapsedMs: elapsed(started)
      };
    } finally {
      repository.close();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function measureEntityBaseline(): Promise<HistoricalBaselineReport["entities"]> {
  const started = performance.now();
  const expected = uniqueSorted([...ENTITY_EXTRACTION_BASELINE_EXPECTED]);
  const falsePositives = uniqueSorted([...ENTITY_EXTRACTION_BASELINE_FALSE_POSITIVES]);
  const extracted = uniqueSorted([...expected, ...falsePositives]);

  // This versioned comparison point preserves results from before the current
  // entity extractor instead of silently replacing them on every run.
  return {
    expected,
    extracted,
    truePositives: expected,
    falsePositives,
    falseNegatives: [],
    precision: ratio(expected.length, extracted.length),
    recall: 1,
    elapsedMs: elapsed(started)
  };
}

async function measureContextBaseline(): Promise<HistoricalBaselineReport["context"]> {
  const started = performance.now();
  const root = createTempProject("mdgraph-historical-context-");
  try {
    writeMarkdown(root, "docs/recovery-details.md", "Recovery Details", [
      "## First Attempt",
      "",
      "`SessionRecoveryPolicy` retries authentication sessions after cache failures and records recovery diagnostics.",
      "",
      "## Second Attempt",
      "",
      "`SessionRecoveryPolicy` retries authentication sessions after cache failures and records recovery diagnostics.",
      "",
      "## Third Attempt",
      "",
      "`SessionRecoveryPolicy` retries authentication sessions after cache failures and records recovery diagnostics."
    ].join("\n"));
    writeMarkdown(root, "docs/recovery-limits.md", "Recovery Limits", "`SessionRecoveryPolicy` caps retries before returning a terminal authentication response.");
    writeMarkdown(root, "docs/recovery-operations.md", "Recovery Operations", "`SessionRecoveryPolicy` routes exhausted attempts to operational diagnostics and an incident runbook.");
    await indexProject(root, { full: true });

    const repository = new GraphRepository(openDatabase(root));
    try {
      const config: MDGraphConfig = {
        ...DEFAULT_CONFIG,
        search: { ...DEFAULT_CONFIG.search, defaultLimit: 12, maxContextChars: 50_000 }
      };
      const context = buildContext(repository, config, "SessionRecoveryPolicy", {
        debug: true,
        searchLimit: 12,
        maxChars: 50_000
      });
      const pairwise = pairwiseJaccard(context.items.map((item) => item.content));
      return {
        packingStrategy: "mmr-style-document-round-robin",
        itemCount: context.items.length,
        uniqueDocuments: new Set(context.items.map((item) => item.path)).size,
        diversityRatio: context.debug?.packingDiversityRatio ?? 0,
        averagePairwiseJaccard: average(pairwise),
        maximumPairwiseJaccard: pairwise.length ? Math.max(...pairwise) : 0,
        nearDuplicatePairs: pairwise.filter((value) => value >= 0.8).length,
        elapsedMs: elapsed(started)
      };
    } finally {
      repository.close();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function createTempProject(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeMarkdown(root: string, relativePath: string, title: string, content: string): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `# ${title}\n\n${content}\n`, "utf8");
}

function resultRank(results: ReturnType<typeof searchGraph>, expectedDocument: string): number | null {
  const index = results.findIndex((result) => result.document.path === expectedDocument);
  return index >= 0 ? index + 1 : null;
}

function recallAt5(ranks: Array<number | null>): number {
  return ratio(ranks.filter((rank) => rank !== null && rank <= 5).length, ranks.length);
}

function pairwiseJaccard(contents: string[]): number[] {
  const tokenSets = contents.map(tokensForSimilarity);
  const similarities: number[] = [];
  for (let left = 0; left < tokenSets.length; left += 1) {
    for (let right = left + 1; right < tokenSets.length; right += 1) {
      const union = new Set([...tokenSets[left], ...tokenSets[right]]);
      const intersection = [...tokenSets[left]].filter((token) => tokenSets[right].has(token));
      similarities.push(ratio(intersection.length, union.size));
    }
  }
  return similarities;
}

function tokensForSimilarity(content: string): Set<string> {
  return new Set(content.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function average(values: number[]): number {
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function ratio(numerator: number, denominator: number): number {
  return denominator ? round(numerator / denominator) : 0;
}

function elapsed(started: number): number {
  return Number((performance.now() - started).toFixed(2));
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

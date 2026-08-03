import fs from "node:fs";
import http, { type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load-config.js";
import { openDatabase } from "../src/db/connection.js";
import { GraphRepository } from "../src/db/repositories.js";
import { evaluateRetrievalAsync } from "../src/evaluation/retrieval-eval.js";
import { indexProject } from "../src/indexer.js";
import { MCPServer } from "../src/mcp/server.js";
import { ToolHandler } from "../src/mcp/tools.js";
import type { JsonRpcNotification, JsonRpcRequest, JsonRpcResponse, JsonRpcTransport, MessageHandler } from "../src/mcp/transport.js";
import { buildContextAsync } from "../src/query/context-builder.js";
import { explainSearchGraphAsync, searchGraph } from "../src/query/search.js";
import { semanticStatusReportAsync } from "../src/semantic/status.js";
import { createEmbeddingProvider, isSupportedEmbeddingProvider, registerEmbeddingProvider } from "../src/semantic/provider-registry.js";
import { SYNONYM_RETRIEVAL_BASELINE_CASES } from "../src/evaluation/historical-baseline.js";

interface EmbedRequestRecord {
  model: string;
  input: string[];
  dimensions: number;
}

interface FakeOllama {
  endpoint: string;
  requests: EmbedRequestRecord[];
  close: () => Promise<void>;
}

const tempDirs: string[] = [];
const servers: FakeOllama[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("embedding providers", () => {
  it("indexes Ollama vectors in batches and improves no-overlap synonym retrieval through async APIs", async () => {
    const ollama = await startFakeOllama();
    const root = createSynonymProject(ollama.endpoint);

    const indexed = await indexProject(root);
    expect(indexed.counts.vectors).toBe(indexed.counts.chunks);
    expect(ollama.requests.length).toBeGreaterThan(1);
    expect(ollama.requests.every((request) => request.input.length <= 2)).toBe(true);
    expect(ollama.requests.every((request) => request.model === "test-embed" && request.dimensions === 4)).toBe(true);

    const repository = new GraphRepository(openDatabase(root));
    try {
      const config = loadConfig(root);
      const syncResults = searchGraph(repository, config, "authentication login", 5, { queryMode: "semantic" });
      expect(syncResults.every((result) => result.semantic === undefined)).toBe(true);

      const explanation = await explainSearchGraphAsync(repository, config, "authentication login", 5, { queryMode: "semantic" });
      expect(explanation.semanticDiagnostic).toBeUndefined();
      expect(explanation.semanticActive).toBe(true);
      expect(explanation.ranking.optionalReranker).toBe("ollama");
      expect(explanation.results[0]).toMatchObject({
        document: { path: "docs/identity-verification.md" },
        semantic: { provider: "ollama", model: "test-embed" }
      });
      for (const item of SYNONYM_RETRIEVAL_BASELINE_CASES) {
        const synonym = await explainSearchGraphAsync(repository, config, item.query, 5, { queryMode: "semantic" });
        expect(synonym.results[0].document.path).toBe(item.expectedDocument);
      }

      const context = await buildContextAsync(repository, config, "authentication login", { debug: true });
      expect(context.semanticDiagnostic).toBeUndefined();
      expect(context.items[0].path).toBe("docs/identity-verification.md");

      const report = await evaluateRetrievalAsync(repository, config, {
        queryMode: "semantic",
        limit: 5,
        cases: [{
          id: "ollama-synonym",
          query: "authentication login",
          expectedDocuments: ["docs/identity-verification.md"],
          expectedSections: [{ path: "docs/identity-verification.md", heading: "Identity Verification" }],
          expectedEntities: [],
          expectedEdges: [],
          expectedSourceRefs: []
        }]
      });
      expect(report.summary.averageTopKDocumentRecall).toBe(1);
      expect(report.ranking.optionalReranker).toBe("ollama");

      const status = await semanticStatusReportAsync(config, repository.counts(), repository.storageDiagnostics());
      expect(status).toMatchObject({ state: "ready", providerSupported: true, capability: "semantic-model", runtimeStatus: "available" });
    } finally {
      repository.close();
    }

    ollama.requests.length = 0;
    fs.appendFileSync(path.join(root, "docs", "identity-verification.md"), "\n## Session Audit\n\nCredential checks are recorded for review.\n", "utf8");
    const incremental = await indexProject(root);
    const embeddedInputs = ollama.requests.reduce((sum, request) => sum + request.input.length, 0);
    expect(incremental.mode).toBe("incremental");
    expect(incremental.changed).toBe(1);
    expect(incremental.counts.vectors).toBe(incremental.counts.chunks);
    expect(embeddedInputs).toBeGreaterThan(0);
    expect(embeddedInputs).toBeLessThan(incremental.counts.chunks);
  });

  it("degrades async search and MCP results when an indexed provider becomes unavailable", async () => {
    const ollama = await startFakeOllama();
    const root = createSynonymProject(ollama.endpoint);
    await indexProject(root);
    await ollama.close();

    const repository = new GraphRepository(openDatabase(root));
    try {
      const config = loadConfig(root);
      const explanation = await explainSearchGraphAsync(repository, config, "Credential validation", 5, { queryMode: "semantic" });
      expect(explanation.results[0].document.path).toBe("docs/identity-verification.md");
      expect(explanation.semanticActive).toBe(false);
      expect(explanation.semanticDiagnostic).toMatchObject({ provider: "ollama", code: "provider_unavailable", degraded: true });

      const status = await semanticStatusReportAsync(config, repository.counts(), repository.storageDiagnostics());
      expect(status.runtimeStatus).toBe("unavailable");
      expect(status.state).toBe("ready");
    } finally {
      repository.close();
    }

    const result = await new ToolHandler(root).executeAsync("mdgraph_search", { query: "Credential validation" });
    expect(result.content[0].text).toContain("Semantic search degraded");
    expect(result.structuredContent).toEqual(expect.objectContaining({
      semanticDiagnostic: expect.objectContaining({ provider: "ollama", code: "provider_unavailable" }),
      results: expect.any(Array)
    }));

    const cli = await execFileAsync(process.execPath, [
      path.resolve("dist/bin/mdgraph.js"),
      "search",
      "Credential validation",
      "--path",
      root,
      "--semantic",
      "--json"
    ]);
    expect(cli.stderr).toContain("MDGraph semantic fallback [ollama/provider_unavailable]");
    expect(JSON.parse(cli.stdout)).toEqual(expect.arrayContaining([
      expect.objectContaining({ document: expect.objectContaining({ path: "docs/identity-verification.md" }) })
    ]));

    const transport = new TestTransport();
    const server = new MCPServer(transport, { projectRoot: root, watch: false });
    server.start();
    try {
      await transport.receive({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "mdgraph_search", arguments: { query: "Credential validation" } }
      });
      expect(transport.responses[0].result).toEqual(expect.objectContaining({
        content: [expect.objectContaining({ text: expect.stringContaining("Semantic search degraded") })],
        structuredContent: expect.objectContaining({
          semanticDiagnostic: expect.objectContaining({ provider: "ollama", code: "provider_unavailable" })
        })
      }));
    } finally {
      await server.stop();
    }
  });

  it("leaves an existing graph unchanged when complete provider re-embedding fails", async () => {
    const root = createPlainProject();
    await indexProject(root);
    const before = readDocumentHashes(root);

    writeEmbeddingConfig(root, "http://127.0.0.1:1");
    fs.appendFileSync(path.join(root, "docs", "identity-verification.md"), "\nChanged but not committed to the graph.\n", "utf8");

    await expect(indexProject(root)).rejects.toMatchObject({
      name: "EmbeddingProviderError",
      code: "provider_unavailable",
      provider: "ollama"
    });

    expect(readDocumentHashes(root)).toEqual(before);
    const repository = new GraphRepository(openDatabase(root));
    try {
      expect(repository.counts().vectors).toBe(0);
    } finally {
      repository.close();
    }
  });

  it("registers custom providers without allowing built-in overrides", async () => {
    const factory: Parameters<typeof registerEmbeddingProvider>[2] = (config) => ({
      id: config.provider,
      model: config.model,
      dimensions: config.dimensions,
      capability: "semantic-model",
      locality: "in-process",
      availability: async () => ({ status: "available" }),
      embedDocuments: async (inputs) => inputs.map((input) => input.includes("Exact Direction") ? [1, 0] : [2, 2]),
      embedQuery: async (input) => input.includes("invalid vector") ? [1] : [1, 0]
    });
    const unregister = registerEmbeddingProvider("fixture-provider", "semantic-model", factory);
    try {
      expect(isSupportedEmbeddingProvider("fixture-provider")).toBe(true);
      const provider = createEmbeddingProvider({
        enabled: true,
        provider: "fixture-provider",
        model: "fixture-model",
        dimensions: 2
      });
      expect(await provider.embedQuery("anything")).toEqual([1, 0]);
      expect(() => registerEmbeddingProvider("fixture-provider", "semantic-model", () => provider)).toThrow(/already registered/);
      expect(() => registerEmbeddingProvider("ollama", "semantic-model", () => provider)).toThrow(/already registered/);
      expect(() => createEmbeddingProvider({
        enabled: true,
        provider: "ollama",
        model: "test-embed",
        dimensions: 2,
        endpoint: "http://user:secret@127.0.0.1:11434"
      })).toThrow(/must not contain credentials/);

      const root = createCustomProviderProject();
      await indexProject(root);
      const repository = new GraphRepository(openDatabase(root));
      try {
        const explanation = await explainSearchGraphAsync(repository, loadConfig(root), "semantic probe", 2, { queryMode: "semantic" });
        expect(explanation.results[0]).toMatchObject({
          document: { path: "docs/exact-direction.md" },
          semantic: { provider: "fixture-provider", model: "fixture-model", confidence: 1 }
        });
        const invalid = await explainSearchGraphAsync(repository, loadConfig(root), "invalid vector", 2, { queryMode: "semantic" });
        expect(invalid.semanticActive).toBe(false);
        expect(invalid.semanticDiagnostic).toMatchObject({
          provider: "fixture-provider",
          code: "dimension_mismatch",
          degraded: true
        });
      } finally {
        repository.close();
      }
    } finally {
      unregister();
    }
    expect(isSupportedEmbeddingProvider("fixture-provider")).toBe(false);

    const replacementUnregister = registerEmbeddingProvider("fixture-provider", "semantic-model", factory);
    try {
      unregister();
      expect(isSupportedEmbeddingProvider("fixture-provider")).toBe(true);
    } finally {
      replacementUnregister();
    }
  });
});

function createSynonymProject(endpoint: string): string {
  const root = createPlainProject();
  writeEmbeddingConfig(root, endpoint);
  return root;
}

function createPlainProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-ollama-provider-"));
  tempDirs.push(root);
  for (const item of SYNONYM_RETRIEVAL_BASELINE_CASES) {
    const target = path.join(root, item.expectedDocument);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `# ${item.title}\n\n${item.content}\n`, "utf8");
  }
  return root;
}

function writeEmbeddingConfig(root: string, endpoint: string): void {
  const directory = path.join(root, ".mdgraph");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "config.json"), JSON.stringify({
    embedding: {
      enabled: true,
      provider: "ollama",
      model: "test-embed",
      dimensions: 4,
      endpoint,
      timeoutMs: 500,
      batchSize: 2
    }
  }), "utf8");
}

function createCustomProviderProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-custom-provider-"));
  tempDirs.push(root);
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "scaled-angle.md"), "# Scaled Angle\n\nA diagonal representation with a larger magnitude.\n", "utf8");
  fs.writeFileSync(path.join(root, "docs", "exact-direction.md"), "# Exact Direction\n\nA precise directional representation.\n", "utf8");
  fs.mkdirSync(path.join(root, ".mdgraph"), { recursive: true });
  fs.writeFileSync(path.join(root, ".mdgraph", "config.json"), JSON.stringify({
    embedding: {
      enabled: true,
      provider: "fixture-provider",
      model: "fixture-model",
      dimensions: 2,
      batchSize: 1
    }
  }), "utf8");
  return root;
}

function readDocumentHashes(root: string): Map<string, { id: string; hash: string }> {
  const repository = new GraphRepository(openDatabase(root));
  try {
    return repository.documentHashes();
  } finally {
    repository.close();
  }
}

async function startFakeOllama(): Promise<FakeOllama> {
  const requests: EmbedRequestRecord[] = [];
  const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/api/tags") {
      sendJson(response, 200, { models: [{ name: "test-embed:latest", model: "test-embed:latest" }] });
      return;
    }
    if (request.method !== "POST" || request.url !== "/api/embed") {
      sendJson(response, 404, { error: "not found" });
      return;
    }

    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const parsed = JSON.parse(body) as { model: string; input: string | string[]; dimensions: number };
      const inputs = Array.isArray(parsed.input) ? parsed.input : [parsed.input];
      requests.push({ model: parsed.model, input: inputs, dimensions: parsed.dimensions });
      sendJson(response, 200, {
        model: parsed.model,
        embeddings: inputs.map((input) => semanticVector(input, parsed.dimensions))
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  let closed = false;
  const fake = {
    endpoint: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      if (closed) {
        return;
      }
      closed = true;
      await closeServer(server);
    }
  };
  servers.push(fake);
  return fake;
}

function semanticVector(input: string, dimensions: number): number[] {
  const normalized = input.toLowerCase();
  const vector = Array.from({ length: dimensions }, () => 0);
  if (/(renew|jwt|signing credential|token signing|key material)/u.test(normalized)) {
    vector[3] = 1;
  } else if (/(authentication|login|credential validation|user session|identity)/u.test(normalized)) {
    vector[0] = 1;
  } else if (/(redis|timeout|retry|datastore|backoff|another attempt)/u.test(normalized)) {
    vector[1] = 1;
  } else if (/(rollback|deploy|release|rollout|production health)/u.test(normalized)) {
    vector[2] = 1;
  } else {
    vector[3] = 1;
  }
  return vector;
}

function sendJson(response: http.ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

class TestTransport implements JsonRpcTransport {
  readonly responses: JsonRpcResponse[] = [];
  private handler: MessageHandler | undefined;

  start(handler: MessageHandler): void {
    this.handler = handler;
  }

  stop(): void {
    this.handler = undefined;
  }

  async receive(message: JsonRpcRequest | JsonRpcNotification): Promise<void> {
    await this.handler?.(message);
  }

  sendResult(id: string | number, result: unknown): void {
    this.responses.push({ jsonrpc: "2.0", id, result });
  }

  sendError(id: string | number | null, code: number, message: string, data?: unknown): void {
    this.responses.push({ jsonrpc: "2.0", id, error: { code, message, data } });
  }
}

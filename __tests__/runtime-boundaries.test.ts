import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { indexProject } from "../src/indexer.js";
import { ToolHandler } from "../src/mcp/tools.js";
import { MCPServer } from "../src/mcp/server.js";
import type { JsonRpcTransport, MessageHandler } from "../src/mcp/transport.js";
import { createOllamaEmbeddingProvider } from "../src/semantic/ollama-provider.js";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-boundaries-"));
  const served = path.join(root, "served");
  const external = path.join(root, "external");
  fs.mkdirSync(served); fs.mkdirSync(external);
  return { root, served, external };
}

describe("served project boundaries", () => {
  it("allows internal links and linked served roots, rejects external project and storage links through MCP", async () => {
    const { root, served, external } = fixture();
    const child = path.join(served, "child"); fs.mkdirSync(child);
    fs.writeFileSync(path.join(child, "doc.md"), "# InternalService\nInternal content.\n");
    fs.writeFileSync(path.join(external, "doc.md"), "# ExternalService\nExternal content.\n");
    await indexProject(child); await indexProject(external);
    const inside = path.join(served, "inside"); const outside = path.join(served, "outside");
    fs.symlinkSync(child, inside, "junction"); fs.symlinkSync(external, outside, "junction");
    const linkedRoot = path.join(root, "linked-root"); fs.symlinkSync(served, linkedRoot, "junction");
    const handler = new ToolHandler(linkedRoot);
    expect(JSON.stringify(await handler.executeAsync("mdgraph_search", { projectPath: inside, query: "InternalService" }))).toContain("Internal content");
    await expect(handler.executeAsync("mdgraph_search", { projectPath: outside, query: "ExternalService" })).rejects.toThrow(/served project root/);
    const storageProject = path.join(served, "storage"); fs.mkdirSync(storageProject);
    fs.symlinkSync(path.join(external, ".mdgraph"), path.join(storageProject, ".mdgraph"), "junction");
    expect(() => handler.execute("mdgraph_status", { projectPath: storageProject })).toThrow(/served project root/);

    let receive: MessageHandler | undefined;
    const responses: unknown[] = [];
    const transport: JsonRpcTransport = {
      start(fn) { receive = fn; }, stop() {},
      sendResult(id, result) { responses.push({ id, result }); },
      sendError(id, code, message) { responses.push({ id, code, message }); }
    };
    const server = new MCPServer(transport, { projectRoot: linkedRoot, watch: false }); server.start();
    try {
      await receive!({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: pathToFileURL(outside).href } });
      expect(responses[0]).toMatchObject({ id: 1, code: -32602 });
      await receive!({ jsonrpc: "2.0", id: 2, method: "initialize", params: { rootUri: pathToFileURL(inside).href } });
      expect(responses[1]).toHaveProperty("result");
      await receive!({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "mdgraph_search", arguments: { query: "InternalService" } } });
      expect(JSON.stringify(responses[2])).toContain("Internal content");
    } finally { await server.stop(); }
  });
});

describe("complete embedding request deadline", () => {
  it.each(["headers", "body", "error-body"])("times out stalled %s and recovers on the next request", async (mode) => {
    let stalled = true;
    const server = http.createServer((req, res) => {
      if (stalled) {
        if (mode !== "headers") { res.writeHead(mode === "error-body" ? 500 : 200); res.flushHeaders(); res.write(" "); }
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ embeddings: [[1, 0]] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const provider = createOllamaEmbeddingProvider({ enabled: true, provider: "ollama", model: "test", dimensions: 2, timeoutMs: 100, endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
    try {
      await expect(provider.embedQuery("query")).rejects.toMatchObject({ code: "provider_timeout" });
      stalled = false;
      await expect(provider.embedQuery("query")).resolves.toEqual([1, 0]);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it("returns lexical MCP results after a stalled embedding body and preserves the index", async () => {
    let stalled = false;
    const server = http.createServer((req, res) => {
      if (stalled) { res.writeHead(200); res.flushHeaders(); return; }
      let body = ""; req.on("data", (data) => body += data); req.on("end", () => {
        const input = JSON.parse(body).input as string[];
        res.end(JSON.stringify({ embeddings: input.map(() => [1, 0]) }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { served } = fixture(); fs.mkdirSync(path.join(served, ".mdgraph"));
    fs.writeFileSync(path.join(served, "doc.md"), "# RecoveryService\nReliable lexical result.\n");
    fs.writeFileSync(path.join(served, ".mdgraph/config.json"), JSON.stringify({ embedding: { enabled: true, provider: "ollama", model: "test", dimensions: 2, timeoutMs: 100, endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}` } }));
    try {
      await indexProject(served); stalled = true;
      const handler = new ToolHandler(served);
      const result = await handler.executeAsync("mdgraph_search", { query: "RecoveryService" });
      expect(JSON.stringify(result)).toContain("provider_timeout");
      expect(JSON.stringify(result)).toContain("Reliable lexical result");
      fs.appendFileSync(path.join(served, "doc.md"), "\nUpdated text\n");
      await expect(indexProject(served)).rejects.toMatchObject({ code: "provider_timeout" });
      expect(JSON.stringify(handler.execute("mdgraph_search", { query: "RecoveryService" }))).not.toContain("Updated text");
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});

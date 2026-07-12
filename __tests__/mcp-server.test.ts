import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexProject } from "../src/indexer.js";
import { MCPServer } from "../src/mcp/server.js";
import type { JsonRpcNotification, JsonRpcRequest, JsonRpcTransport } from "../src/mcp/transport.js";
import { createFixtureDocs } from "./fixtures.js";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("MCPServer", () => {
  it("handles initialize, tools/list, and tools/call", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-mcp-server-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    await indexProject(root);

    const transport = new FakeTransport();
    const server = new MCPServer(transport, { projectRoot: root, watch: false });
    server.start();

    await transport.receive({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: pathToFileUri(root) } });
    await transport.receive({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    await transport.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "mdgraph_search", arguments: { query: "AuthService" } }
    });

    expect(transport.responses[0].result).toMatchObject({ serverInfo: { name: "mdgraph" } });
    expect(JSON.stringify(transport.responses[0].result)).toContain("task-start documentation brief");
    expect(JSON.stringify(transport.responses[0].result)).toContain("Default order for Markdown/documentation questions");
    expect(JSON.stringify(transport.responses[0].result)).toContain("Raw file reads or text search only when MDGraph is inactive");
    expect(JSON.stringify(transport.responses[1].result)).toContain("mdgraph_context");
    expect(JSON.stringify(transport.responses[2].result)).toContain("auth-v2-design.md");
  });

  it("returns unindexed guidance when watch is disabled", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-mcp-unindexed-"));
    tempDirs.push(root);

    const transport = new FakeTransport();
    const server = new MCPServer(transport, { projectRoot: root, watch: false });
    server.start();

    await transport.receive({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: pathToFileUri(root) } });

    expect(JSON.stringify(transport.responses[0].result)).toContain("Do not create or");
  });

  it("uses initialize rootUri as the default project root for later tool calls", async () => {
    const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-mcp-server-root-"));
    const initializedRoot = path.join(serverRoot, "workspace");
    tempDirs.push(serverRoot);
    createSingleDoc(initializedRoot, "initialized.md", "InitializedService");
    await indexProject(initializedRoot);

    const transport = new FakeTransport();
    const server = new MCPServer(transport, { projectRoot: serverRoot, watch: false });
    server.start();

    await transport.receive({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: pathToFileUri(initializedRoot) } });
    await transport.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "mdgraph_search", arguments: { query: "InitializedService" } }
    });

    expect(JSON.stringify(transport.responses[1].result)).toContain("initialized.md");
  });

  it("uses workspaceFolders as initialize root when rootUri is absent", async () => {
    const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-mcp-server-folder-root-"));
    const workspaceRoot = path.join(serverRoot, "workspace");
    tempDirs.push(serverRoot);
    createSingleDoc(workspaceRoot, "workspace.md", "WorkspaceService");
    await indexProject(workspaceRoot);

    const transport = new FakeTransport();
    const server = new MCPServer(transport, { projectRoot: serverRoot, watch: false });
    server.start();

    await transport.receive({ jsonrpc: "2.0", id: 1, method: "initialize", params: { workspaceFolders: [{ uri: pathToFileUri(workspaceRoot) }] } });
    await transport.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "mdgraph_search", arguments: { query: "WorkspaceService" } }
    });

    expect(JSON.stringify(transport.responses[1].result)).toContain("workspace.md");
  });

  it("rejects initialize roots outside the served project root", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-mcp-bound-root-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-mcp-outside-root-"));
    tempDirs.push(root, outside);
    createFixtureDocs(root);
    createFixtureDocs(outside);
    await indexProject(root);
    await indexProject(outside);

    const transport = new FakeTransport();
    const server = new MCPServer(transport, { projectRoot: root, watch: false });
    server.start();

    await transport.receive({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: pathToFileUri(outside) } });

    expect(transport.responses[0].error).toMatchObject({ code: -32602, data: { layer: "initialize.params" } });
  });

  it("rejects invalid initialize roots instead of silently falling back", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-mcp-invalid-root-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    await indexProject(root);

    const transport = new FakeTransport();
    const server = new MCPServer(transport, { projectRoot: root, watch: false });
    server.start();

    await transport.receive({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: pathToFileUri(path.join(root, "missing")) } });

    expect(transport.responses[0].error).toMatchObject({ code: -32602 });
  });

  it("separates tool input errors from internal execution errors", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-mcp-errors-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    await indexProject(root);

    const transport = new FakeTransport();
    const server = new MCPServer(transport, { projectRoot: root, watch: false });
    server.start();

    await transport.receive({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "mdgraph_search", arguments: {} }
    });
    const configPath = path.join(root, ".mdgraph", "config.json");
    fs.writeFileSync(configPath, "{ invalid", "utf8");
    await transport.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "mdgraph_search", arguments: { query: "AuthService" } }
    });

    expect(transport.responses[0].error).toMatchObject({ code: -32602, data: { layer: "tools.call.input", tool: "mdgraph_search" } });
    expect(transport.responses[1].error).toMatchObject({ code: -32603, data: { layer: "tools.call.execute", tool: "mdgraph_search" } });
    expect((transport.responses[1].error as { message: string }).message).toContain("MDGraph MCP internal error");
    expect((transport.responses[1].error as { message: string }).message).toContain("MDGRAPH_MCP_DEBUG=1");
  });

  it("writes MCP debug boundaries to stderr when MDGRAPH_MCP_DEBUG=1", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-mcp-debug-"));
    tempDirs.push(root);
    createFixtureDocs(root);
    await indexProject(root);

    const transport = new FakeTransport();
    const stderrLines: string[] = [];
    const originalEnv = process.env.MDGRAPH_MCP_DEBUG;
    const originalError = console.error;
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    process.env.MDGRAPH_MCP_DEBUG = "1";
    console.error = (message?: unknown, ...optional: unknown[]) => {
      stderrLines.push([message, ...optional].map((value) => String(value)).join(" "));
    };
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrLines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stderr.write;

    try {
      const server = new MCPServer(transport, { projectRoot: root, watch: true, debounceMs: 10 });
      server.start();
      await transport.receive({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: pathToFileUri(root) } });
      await transport.receive({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      await transport.receive({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "mdgraph_status", arguments: {} } });
      await server.stop();
    } finally {
      console.error = originalError;
      process.stderr.write = originalStderrWrite;
      if (originalEnv === undefined) {
        delete process.env.MDGRAPH_MCP_DEBUG;
      } else {
        process.env.MDGRAPH_MCP_DEBUG = originalEnv;
      }
    }

    expect(stderrLines.some((line) => line.includes("[MDGraph MCP] server start"))).toBe(true);
    expect(stderrLines.some((line) => line.includes("[MDGraph MCP] initialize request"))).toBe(true);
    expect(stderrLines.some((line) => line.includes("[MDGraph MCP] tools/call result"))).toBe(true);
  });

  it("keeps MCP search fresh by default", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-mcp-watch-"));
    tempDirs.push(root);
    createFixtureDocs(root);

    const transport = new FakeTransport();
    const server = new MCPServer(transport, { projectRoot: root, debounceMs: 10 });
    server.start();

    try {
      await transport.receive({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: pathToFileUri(root) } });
      await transport.receive({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "mdgraph_search", arguments: { query: "AuthService" } }
      });

      expect(JSON.stringify(transport.responses[1].result)).toContain("auth-v2-design.md");

      fs.appendFileSync(path.join(root, "docs", "auth-v2-design.md"), "\n## Fresh Service\n\n`FreshService` is added while MCP watch mode is active.\n", "utf8");

      await waitForSearchResult(transport, "FreshService", "auth-v2-design.md");
      expect(JSON.stringify(transport.responses.at(-1)?.result)).toContain("auth-v2-design.md");
    } finally {
      await server.stop();
    }
  }, 10000);

  it("does not log no-op watch reindexes to stderr", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdgraph-mcp-watch-silent-"));
    tempDirs.push(root);
    createFixtureDocs(root);

    const transport = new FakeTransport();
    const watchLogs: string[] = [];
    const originalError = console.error;
    console.error = (message?: unknown, ...optional: unknown[]) => {
      watchLogs.push([message, ...optional].map((value) => String(value)).join(" "));
    };

    const server = new MCPServer(transport, { projectRoot: root, debounceMs: 10 });
    server.start();

    try {
      await transport.receive({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: pathToFileUri(root) } });
      expect(watchIndexLogs(watchLogs)).toHaveLength(1);

      const authPath = path.join(root, "docs", "auth-v2-design.md");
      const originalContent = fs.readFileSync(authPath, "utf8");
      fs.writeFileSync(authPath, `${originalContent}\nTemporary watch churn.\n`, "utf8");
      fs.writeFileSync(authPath, originalContent, "utf8");
      await delay(300);
      expect(watchIndexLogs(watchLogs)).toHaveLength(1);

      fs.appendFileSync(authPath, "\n## Fresh Service\n\n`FreshService` is added after a no-op rewrite.\n", "utf8");
      await waitForSearchResult(transport, "FreshService", "auth-v2-design.md");
      await waitForWatchLogCount(watchLogs, 2);

      expect(watchIndexLogs(watchLogs)).toHaveLength(2);
    } finally {
      console.error = originalError;
      await server.stop();
    }
  }, 10000);
});

class FakeTransport implements JsonRpcTransport {
  responses: Array<{ id: string | number | null; result?: unknown; error?: unknown }> = [];
  private handler: ((message: JsonRpcRequest | JsonRpcNotification) => Promise<void> | void) | undefined;

  start(handler: (message: JsonRpcRequest | JsonRpcNotification) => Promise<void> | void): void {
    this.handler = handler;
  }

  stop(): void {
    this.handler = undefined;
  }

  async receive(message: JsonRpcRequest | JsonRpcNotification): Promise<void> {
    await this.handler?.(message);
  }

  sendResult(id: string | number, result: unknown): void {
    this.responses.push({ id, result });
  }

  sendError(id: string | number | null, code: number, message: string, data?: unknown): void {
    this.responses.push({ id, error: { code, message, data } });
  }
}

function pathToFileUri(filePath: string): string {
  return `file:///${filePath.replace(/\\/g, "/")}`;
}

function watchIndexLogs(lines: string[]): string[] {
  return lines.filter((line) => line.includes("MDGraph MCP watch indexed"));
}

async function waitForSearchResult(transport: FakeTransport, query: string, expectedText: string): Promise<void> {
  const startedAt = Date.now();
  let requestId = 10;

  while (Date.now() - startedAt < 8000) {
    await transport.receive({
      jsonrpc: "2.0",
      id: requestId,
      method: "tools/call",
      params: { name: "mdgraph_search", arguments: { query } }
    });

    if (JSON.stringify(transport.responses.at(-1)?.result).includes(expectedText)) {
      return;
    }

    requestId += 1;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for MCP watch search result: ${query}`);
}

async function waitForWatchLogCount(lines: string[], count: number): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 8000) {
    if (watchIndexLogs(lines).length >= count) {
      return;
    }

    await delay(25);
  }

  throw new Error(`Timed out waiting for ${count} watch log(s); saw ${watchIndexLogs(lines).length}.`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createSingleDoc(root: string, fileName: string, entityName: string): void {
  const docsDir = path.join(root, "docs");
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, fileName), [
    "---",
    `title: ${entityName} Doc`,
    "type: design",
    "defines:",
    `  - ${entityName}`,
    "---",
    `# ${entityName}`,
    ""
  ].join("\n"), "utf8");
}

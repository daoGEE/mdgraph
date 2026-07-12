import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ErrorCodes, StdioTransport, type JsonRpcNotification, type JsonRpcRequest, type JsonRpcTransport } from "./transport.js";
import { errorMessage, initializeErrorMessage, internalToolErrorMessage, mcpDebug, mcpErrorData } from "./debug.js";
import { SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS_UNINDEXED } from "./server-instructions.js";
import { McpInputError, ToolHandler, hasIndex, tools } from "./tools.js";
import { packageVersion } from "../version.js";
import { isPathInsideOrEqual } from "../utils/path-safety.js";
import { watchProject, type WatchHandle } from "../watcher/file-watcher.js";

export const PROTOCOL_VERSION = "2024-11-05";

export interface MCPServerOptions {
  projectRoot?: string;
  watch?: boolean;
  semantic?: boolean;
  debounceMs?: number;
}

export class MCPServer {
  private readonly boundProjectRoot: string;
  private projectRoot: string;
  private toolHandler: ToolHandler;
  private readonly watchEnabled: boolean;
  private readonly watchSemantic: boolean | undefined;
  private readonly watchDebounceMs: number | undefined;
  private watchHandle: Promise<WatchHandle> | undefined;
  private watchRoot: string | undefined;

  constructor(private readonly transport: JsonRpcTransport, options: MCPServerOptions = {}) {
    this.boundProjectRoot = validatedProjectRoot(path.resolve(options.projectRoot ?? process.cwd()));
    this.projectRoot = this.boundProjectRoot;
    this.toolHandler = new ToolHandler(this.projectRoot, this.boundProjectRoot);
    this.watchEnabled = options.watch ?? true;
    this.watchSemantic = options.semantic;
    this.watchDebounceMs = options.debounceMs;
  }

  start(): void {
    mcpDebug("server start", {
      boundProjectRoot: this.boundProjectRoot,
      watch: this.watchEnabled,
      semantic: this.watchSemantic ?? false,
      debounceMs: this.watchDebounceMs ?? null
    });
    this.transport.start(this.handleMessage.bind(this));
  }

  async stop(): Promise<void> {
    mcpDebug("server stop", { projectRoot: this.projectRoot, watchRoot: this.watchRoot ?? null });
    await this.stopWatch();
    this.transport.stop();
  }

  private async handleMessage(message: JsonRpcRequest | JsonRpcNotification): Promise<void> {
    const isRequest = "id" in message;

    switch (message.method) {
      case "initialize":
        if (isRequest) {
          mcpDebug("initialize request", { id: message.id });
          await this.handleInitialize(message);
        }
        return;
      case "initialized":
        return;
      case "ping":
        if (isRequest) {
          this.transport.sendResult(message.id, {});
        }
        return;
      case "tools/list":
        if (isRequest) {
          mcpDebug("tools/list request", { id: message.id });
          this.transport.sendResult(message.id, { tools });
        }
        return;
      case "tools/call":
        if (isRequest) {
          mcpDebug("tools/call request", { id: message.id });
          this.handleToolsCall(message);
        }
        return;
      case "resources/list":
        if (isRequest) {
          this.transport.sendResult(message.id, { resources: [] });
        }
        return;
      case "resources/templates/list":
        if (isRequest) {
          this.transport.sendResult(message.id, { resourceTemplates: [] });
        }
        return;
      case "prompts/list":
        if (isRequest) {
          this.transport.sendResult(message.id, { prompts: [] });
        }
        return;
      default:
        if (isRequest) {
          this.transport.sendError(message.id, ErrorCodes.MethodNotFound, `Method not found: ${message.method}`, mcpErrorData("protocol.dispatch", { method: message.method }));
        }
    }
  }

  private async handleInitialize(request: JsonRpcRequest): Promise<void> {
    let projectRoot: string;
    try {
      projectRoot = validatedProjectRoot(projectRootFromInitialize(request.params) ?? this.projectRoot);
      if (!isPathInsideOrEqual(this.boundProjectRoot, projectRoot)) {
        throw new Error(`Initialize root must stay inside served project root: ${this.boundProjectRoot}`);
      }
    } catch (error) {
      mcpDebug("initialize rejected", { id: request.id, error: errorMessage(error) });
      this.transport.sendError(request.id, ErrorCodes.InvalidParams, error instanceof Error ? error.message : String(error), mcpErrorData("initialize.params", { projectRoot: this.projectRoot }));
      return;
    }
    try {
      await this.ensureWatch(projectRoot);
    } catch (error) {
      mcpDebug("initialize watch failure", { id: request.id, projectRoot, error: errorMessage(error) });
      this.transport.sendError(request.id, ErrorCodes.InternalError, initializeErrorMessage(error), mcpErrorData("initialize.watch", { projectRoot }));
      return;
    }
    this.projectRoot = projectRoot;
    this.toolHandler = new ToolHandler(projectRoot, this.boundProjectRoot);
    mcpDebug("initialize resolved", { id: request.id, projectRoot, indexed: hasIndex(projectRoot) });
    this.transport.sendResult(request.id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "mdgraph", version: packageVersion() },
      instructions: hasIndex(projectRoot) ? SERVER_INSTRUCTIONS : SERVER_INSTRUCTIONS_UNINDEXED
    });
  }

  private handleToolsCall(request: JsonRpcRequest): void {
    const params = request.params as { name?: unknown; arguments?: unknown } | undefined;
    if (!params || typeof params.name !== "string") {
      this.transport.sendError(request.id, ErrorCodes.InvalidParams, "Missing tool name", mcpErrorData("tools.call.params"));
      return;
    }

    const tool = tools.find((candidate) => candidate.name === params.name);
    if (!tool) {
      this.transport.sendError(request.id, ErrorCodes.InvalidParams, `Unknown tool: ${params.name}`, mcpErrorData("tools.call.params", { tool: params.name }));
      return;
    }

    try {
      const args = params.arguments && typeof params.arguments === "object" ? params.arguments as Record<string, unknown> : {};
      const result = this.toolHandler.execute(params.name, args);
      mcpDebug("tools/call result", {
        id: request.id,
        tool: params.name,
        isError: result.isError ?? false,
        hasStructuredContent: result.structuredContent !== undefined
      });
      this.transport.sendResult(request.id, result);
    } catch (error) {
      const code = error instanceof McpInputError ? ErrorCodes.InvalidParams : ErrorCodes.InternalError;
      mcpDebug("tools/call failure", { id: request.id, tool: params.name, code, error: errorMessage(error) });
      this.transport.sendError(
        request.id,
        code,
        code === ErrorCodes.InvalidParams ? errorMessage(error) : internalToolErrorMessage(error),
        mcpErrorData(code === ErrorCodes.InvalidParams ? "tools.call.input" : "tools.call.execute", { tool: params.name })
      );
    }
  }

  private async ensureWatch(projectRoot: string): Promise<void> {
    if (!this.watchEnabled) {
      return;
    }
    if (this.watchRoot === projectRoot && this.watchHandle) {
      mcpDebug("watch reuse", { projectRoot });
      await this.watchHandle;
      return;
    }

    await this.stopWatch();
    this.watchRoot = projectRoot;
    mcpDebug("watch start", { projectRoot, semantic: this.watchSemantic ?? false, debounceMs: this.watchDebounceMs ?? null });
    const watchHandle = watchProject(projectRoot, {
      semantic: this.watchSemantic,
      debounceMs: this.watchDebounceMs,
      onIndexed: (result) => {
        if (result.changed > 0 || result.deleted > 0 || result.skipped > 0) {
          console.error(`MDGraph MCP watch indexed ${result.changed} changed, ${result.deleted} deleted, ${result.unchanged} unchanged, ${result.skipped} skipped document(s).`);
        }
      },
      onError: (error) => {
        console.error(`MDGraph MCP watch failed: ${error.message}`);
      }
    });
    this.watchHandle = watchHandle;
    try {
      await watchHandle;
      mcpDebug("watch ready", { projectRoot });
    } catch (error) {
      if (this.watchHandle === watchHandle) {
        this.watchHandle = undefined;
        this.watchRoot = undefined;
      }
      mcpDebug("watch startup failure", { projectRoot, error: errorMessage(error) });
      throw error;
    }
  }

  private async stopWatch(): Promise<void> {
    if (!this.watchHandle) {
      this.watchRoot = undefined;
      return;
    }
    const watchHandle = this.watchHandle;
    this.watchHandle = undefined;
    this.watchRoot = undefined;
    const handle = await watchHandle;
    mcpDebug("watch stop", { projectRoot: this.projectRoot });
    await handle.close();
  }
}

export function startStdioMcpServer(options: MCPServerOptions = {}): MCPServer {
  const server = new MCPServer(new StdioTransport(), options);
  server.start();
  return server;
}

function projectRootFromInitialize(params: unknown): string | undefined {
  if (!params || typeof params !== "object") {
    return undefined;
  }
  const record = params as { rootUri?: unknown; workspaceFolders?: Array<{ uri?: unknown }> };
  if (typeof record.rootUri === "string") {
    return fileUriToPath(record.rootUri);
  }
  const firstFolder = record.workspaceFolders?.[0]?.uri;
  return typeof firstFolder === "string" ? fileUriToPath(firstFolder) : undefined;
}

function fileUriToPath(uri: string): string {
  return path.resolve(fileURLToPath(uri));
}

function validatedProjectRoot(projectRoot: string): string {
  const resolved = path.resolve(projectRoot);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Project root does not exist: ${resolved}`);
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error(`Project root is not a directory: ${resolved}`);
  }
  return resolved;
}

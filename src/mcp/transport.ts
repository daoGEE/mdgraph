import readline from "node:readline";
import type { Readable, Writable } from "node:stream";
import { MCP_LIMITS } from "../config/limits.js";
import { errorMessage, mcpDebug, mcpErrorData } from "./debug.js";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

export const ErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603
} as const;

export type MessageHandler = (message: JsonRpcRequest | JsonRpcNotification) => Promise<void> | void;

export interface JsonRpcTransport {
  start(handler: MessageHandler): void;
  stop(): void;
  sendResult(id: string | number, result: unknown): void;
  sendError(id: string | number | null, code: number, message: string, data?: unknown): void;
}

export class StdioTransport implements JsonRpcTransport {
  private reader: readline.Interface | undefined;
  private handler: MessageHandler | undefined;

  constructor(private readonly input: Readable = process.stdin, private readonly output: Writable = process.stdout) {}

  start(handler: MessageHandler): void {
    this.handler = handler;
    this.reader = readline.createInterface({ input: this.input });
    this.reader.on("line", (line) => {
      void this.handleLine(line);
    });
  }

  stop(): void {
    this.reader?.close();
    this.reader = undefined;
  }

  sendResult(id: string | number, result: unknown): void {
    this.write({ jsonrpc: "2.0", id, result });
  }

  sendError(id: string | number | null, code: number, message: string, data?: unknown): void {
    this.write({ jsonrpc: "2.0", id, error: { code, message, data } });
  }

  private async handleLine(line: string): Promise<void> {
    if (Buffer.byteLength(line, "utf8") > MCP_LIMITS.jsonRpcLineBytes) {
      mcpDebug("transport parse rejection", { reason: "line_too_large", bytes: Buffer.byteLength(line, "utf8") });
      this.sendError(null, ErrorCodes.ParseError, `Parse error: JSON-RPC line exceeds ${MCP_LIMITS.jsonRpcLineBytes} bytes`, mcpErrorData("transport.parse", { reason: "line_too_large" }));
      return;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      mcpDebug("transport parse rejection", { reason: "invalid_json" });
      this.sendError(null, ErrorCodes.ParseError, "Parse error: invalid JSON", mcpErrorData("transport.parse", { reason: "invalid_json" }));
      return;
    }

    if (!isValidMessage(parsed)) {
      mcpDebug("transport parse rejection", { reason: "invalid_request_shape" });
      this.sendError(null, ErrorCodes.InvalidRequest, "Invalid Request: not a JSON-RPC 2.0 request or notification", mcpErrorData("transport.validate", { reason: "invalid_request_shape" }));
      return;
    }

    mcpDebug("transport received", {
      method: (parsed as JsonRpcRequest | JsonRpcNotification).method,
      isRequest: "id" in (parsed as unknown as Record<string, unknown>)
    });

    try {
      await this.handler?.(parsed);
    } catch (error) {
      mcpDebug("transport handler failure", {
        method: (parsed as JsonRpcRequest | JsonRpcNotification).method,
        error: errorMessage(error)
      });
      if ("id" in parsed) {
        this.sendError(parsed.id, ErrorCodes.InternalError, error instanceof Error ? error.message : String(error), mcpErrorData("transport.dispatch", { method: (parsed as JsonRpcRequest | JsonRpcNotification).method }));
      }
    }
  }

  private write(response: JsonRpcResponse): void {
    this.output.write(`${JSON.stringify(response)}\n`);
  }
}

function isValidMessage(value: unknown): value is JsonRpcRequest | JsonRpcNotification {
  if (!value || typeof value !== "object") {
    return false;
  }
  const message = value as Record<string, unknown>;
  return message.jsonrpc === "2.0" && typeof message.method === "string";
}

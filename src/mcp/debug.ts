const DEBUG_ENV = "MDGRAPH_MCP_DEBUG";

export type McpErrorLayer =
  | "transport.parse"
  | "transport.validate"
  | "transport.dispatch"
  | "protocol.dispatch"
  | "initialize.params"
  | "initialize.watch"
  | "tools.call.params"
  | "tools.call.input"
  | "tools.call.execute";

export function mcpDebugEnabled(): boolean {
  const raw = process.env[DEBUG_ENV];
  return !!raw && raw !== "0" && raw.toLowerCase() !== "false";
}

export function mcpDebug(message: string, details?: Record<string, unknown>): void {
  if (!mcpDebugEnabled()) {
    return;
  }
  const suffix = details ? ` ${safeDetails(details)}` : "";
  process.stderr.write(`[MDGraph MCP] ${message}${suffix}\n`);
}

export function internalToolErrorMessage(error: unknown): string {
  return [
    `MDGraph MCP internal error: ${errorMessage(error)}.`,
    "Retry once; if it persists, use raw file tools for this task and inspect server stderr with MDGRAPH_MCP_DEBUG=1."
  ].join(" ");
}

export function initializeErrorMessage(error: unknown): string {
  return [
    `MDGraph MCP initialization failed: ${errorMessage(error)}.`,
    "Inspect server stderr for details; set MDGRAPH_MCP_DEBUG=1 to log initialize/tool-call boundaries."
  ].join(" ");
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function mcpErrorData(layer: McpErrorLayer, details?: Record<string, unknown>): Record<string, unknown> {
  return {
    layer,
    ...(details ?? {})
  };
}

function safeDetails(details: Record<string, unknown>): string {
  try {
    return JSON.stringify(details);
  } catch {
    return "[unserializable details]";
  }
}

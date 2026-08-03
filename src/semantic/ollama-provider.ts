import type { EmbeddingConfig, EmbeddingProvider, EmbeddingProviderAvailability } from "./provider.js";
import { EmbeddingProviderError } from "./provider.js";

export const OLLAMA_EMBEDDING_PROVIDER = "ollama";
export const DEFAULT_OLLAMA_ENDPOINT = "http://127.0.0.1:11434";
export const DEFAULT_EMBEDDING_TIMEOUT_MS = 30_000;
export const DEFAULT_EMBEDDING_BATCH_SIZE = 16;

interface OllamaListResponse {
  models?: Array<{ name?: unknown; model?: unknown }>;
}

interface OllamaEmbedResponse {
  model?: unknown;
  embeddings?: unknown;
}

export function createOllamaEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
  const endpoint = validatedEndpoint(config.endpoint ?? DEFAULT_OLLAMA_ENDPOINT);
  const timeoutMs = config.timeoutMs ?? DEFAULT_EMBEDDING_TIMEOUT_MS;

  return {
    id: OLLAMA_EMBEDDING_PROVIDER,
    model: config.model,
    dimensions: config.dimensions,
    capability: "semantic-model",
    locality: "local-service",
    availability: () => ollamaAvailability(endpoint, config.model, timeoutMs),
    embedDocuments: (inputs) => requestEmbeddings(endpoint, config, inputs, timeoutMs),
    embedQuery: async (input) => (await requestEmbeddings(endpoint, config, [input], timeoutMs))[0]
  };
}

async function ollamaAvailability(endpoint: URL, model: string, timeoutMs: number): Promise<EmbeddingProviderAvailability> {
  try {
    const response = await fetchWithTimeout(new URL("/api/tags", endpoint), { method: "GET" }, timeoutMs);
    if (!response.ok) {
      return { status: "unavailable", reason: `Ollama model listing returned HTTP ${response.status}.` };
    }
    const parsed = await readJson(response);
    const models = isRecord(parsed) && Array.isArray((parsed as OllamaListResponse).models) ? (parsed as OllamaListResponse).models ?? [] : [];
    const available = models.some((item) => modelMatches(item.name, model) || modelMatches(item.model, model));
    return available
      ? { status: "available" }
      : { status: "model_missing", reason: `Ollama model '${model}' is not installed.` };
  } catch (error) {
    const providerError = normalizeFetchError(error, timeoutMs);
    return { status: "unavailable", reason: providerError.message };
  }
}

async function requestEmbeddings(endpoint: URL, config: EmbeddingConfig, inputs: string[], timeoutMs: number): Promise<number[][]> {
  if (!inputs.length) {
    return [];
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(new URL("/api/embed", endpoint), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        input: inputs,
        dimensions: config.dimensions,
        truncate: true
      })
    }, timeoutMs);
  } catch (error) {
    throw normalizeFetchError(error, timeoutMs);
  }

  if (!response.ok) {
    const body = (await response.text()).trim().slice(0, 500);
    const suffix = body ? `: ${body}` : "";
    const code = response.status === 404 ? "model_missing" : "http_error";
    throw new EmbeddingProviderError(code, OLLAMA_EMBEDDING_PROVIDER, `Ollama embedding request returned HTTP ${response.status}${suffix}`);
  }

  const parsed = await readJson(response);
  const embeddings = isRecord(parsed) ? (parsed as OllamaEmbedResponse).embeddings : undefined;
  if (!Array.isArray(embeddings) || embeddings.length !== inputs.length) {
    throw new EmbeddingProviderError(
      "invalid_response",
      OLLAMA_EMBEDDING_PROVIDER,
      `Ollama returned ${Array.isArray(embeddings) ? embeddings.length : 0} embedding(s) for ${inputs.length} input(s).`
    );
  }

  return embeddings.map((value, index) => validatedVector(value, config.dimensions, index));
}

async function fetchWithTimeout(url: URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new EmbeddingProviderError("invalid_response", OLLAMA_EMBEDDING_PROVIDER, "Ollama returned invalid JSON.", { cause: error });
  }
}

function validatedVector(value: unknown, dimensions: number, index: number): number[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "number" && Number.isFinite(item))) {
    throw new EmbeddingProviderError("invalid_response", OLLAMA_EMBEDDING_PROVIDER, `Ollama embedding ${index} is not a finite numeric vector.`);
  }
  if (value.length !== dimensions) {
    throw new EmbeddingProviderError(
      "dimension_mismatch",
      OLLAMA_EMBEDDING_PROVIDER,
      `Ollama embedding ${index} has ${value.length} dimensions; configured embedding.dimensions is ${dimensions}.`
    );
  }
  return value;
}

function validatedEndpoint(value: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch (error) {
    throw new EmbeddingProviderError("invalid_config", OLLAMA_EMBEDDING_PROVIDER, `Invalid Ollama endpoint: ${value}`, { cause: error });
  }
  if ((endpoint.protocol !== "http:" && endpoint.protocol !== "https:") || endpoint.username || endpoint.password) {
    throw new EmbeddingProviderError(
      "invalid_config",
      OLLAMA_EMBEDDING_PROVIDER,
      "Ollama endpoint must use http/https and must not contain credentials."
    );
  }
  return endpoint;
}

function normalizeFetchError(error: unknown, timeoutMs: number): EmbeddingProviderError {
  if (error instanceof EmbeddingProviderError) {
    return error;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new EmbeddingProviderError("provider_timeout", OLLAMA_EMBEDDING_PROVIDER, `Ollama embedding request timed out after ${timeoutMs} ms.`, { cause: error });
  }
  return new EmbeddingProviderError(
    "provider_unavailable",
    OLLAMA_EMBEDDING_PROVIDER,
    `Ollama is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    { cause: error }
  );
}

function modelMatches(value: unknown, expected: string): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return value === expected || stripLatest(value) === stripLatest(expected);
}

function stripLatest(value: string): string {
  return value.endsWith(":latest") ? value.slice(0, -":latest".length) : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

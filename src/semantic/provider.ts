import type { MDGraphConfig } from "../types.js";

export type EmbeddingCapability = "lexical-hash" | "semantic-model";
export type EmbeddingRuntimeStatus = "available" | "unavailable" | "model_missing" | "unchecked" | "disabled";
export type EmbeddingProviderErrorCode =
  | "unsupported_provider"
  | "invalid_config"
  | "provider_unavailable"
  | "provider_timeout"
  | "model_missing"
  | "http_error"
  | "invalid_response"
  | "dimension_mismatch"
  | "vectors_unavailable";

export interface EmbeddingProviderAvailability {
  status: Extract<EmbeddingRuntimeStatus, "available" | "unavailable" | "model_missing">;
  reason?: string;
}

export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly dimensions: number;
  readonly capability: EmbeddingCapability;
  readonly locality: "in-process" | "local-service";
  availability(): Promise<EmbeddingProviderAvailability>;
  embedDocuments(inputs: string[]): Promise<number[][]>;
  embedQuery(input: string): Promise<number[]>;
}

export interface EmbeddingDiagnostic {
  code: EmbeddingProviderErrorCode;
  provider: string;
  message: string;
  degraded: true;
}

export type EmbeddingConfig = MDGraphConfig["embedding"];

export class EmbeddingProviderError extends Error {
  readonly name = "EmbeddingProviderError";

  constructor(
    readonly code: EmbeddingProviderErrorCode,
    readonly provider: string,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
  }
}

export function embeddingDiagnostic(error: unknown, provider: string): EmbeddingDiagnostic {
  if (error instanceof EmbeddingProviderError) {
    return { code: error.code, provider: error.provider, message: error.message, degraded: true };
  }
  return {
    code: "provider_unavailable",
    provider,
    message: `Embedding provider '${provider}' failed: ${error instanceof Error ? error.message : String(error)}`,
    degraded: true
  };
}

export function validateEmbeddingVector(provider: string, vector: number[], dimensions: number): void {
  if (vector.length !== dimensions) {
    throw new EmbeddingProviderError(
      "dimension_mismatch",
      provider,
      `Embedding provider '${provider}' returned ${vector.length} dimensions; configured embedding.dimensions is ${dimensions}.`
    );
  }
  if (!vector.every((value) => Number.isFinite(value))) {
    throw new EmbeddingProviderError("invalid_response", provider, `Embedding provider '${provider}' returned a non-finite vector.`);
  }
}

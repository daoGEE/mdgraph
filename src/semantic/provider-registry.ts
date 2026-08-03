import type { EmbeddingConfig, EmbeddingProvider } from "./provider.js";
import { EmbeddingProviderError } from "./provider.js";
import { embedTextLocal, LOCAL_EMBEDDING_PROVIDER } from "./local-embedding.js";
import { createOllamaEmbeddingProvider, OLLAMA_EMBEDDING_PROVIDER } from "./ollama-provider.js";

export const SUPPORTED_EMBEDDING_PROVIDERS = [LOCAL_EMBEDDING_PROVIDER, OLLAMA_EMBEDDING_PROVIDER] as const;
export type EmbeddingProviderFactory = (config: EmbeddingConfig) => EmbeddingProvider;

const registeredProviders = new Map<string, {
  capability: EmbeddingProvider["capability"];
  factory: EmbeddingProviderFactory;
}>();

export function isSupportedEmbeddingProvider(provider: string): boolean {
  return SUPPORTED_EMBEDDING_PROVIDERS.includes(provider as typeof SUPPORTED_EMBEDDING_PROVIDERS[number])
    || registeredProviders.has(provider);
}

export function supportsSynchronousEmbeddingProvider(provider: string): boolean {
  return provider === LOCAL_EMBEDDING_PROVIDER;
}

export function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
  const registered = registeredProviders.get(config.provider);
  if (registered) {
    return validatedProvider(registered.factory(config), config);
  }
  switch (config.provider) {
    case LOCAL_EMBEDDING_PROVIDER:
      return validatedProvider({
        id: LOCAL_EMBEDDING_PROVIDER,
        model: config.model,
        dimensions: config.dimensions,
        capability: "lexical-hash",
        locality: "in-process",
        availability: async () => ({ status: "available" }),
        embedDocuments: async (inputs) => inputs.map((input) => embedTextLocal(input, config.dimensions)),
        embedQuery: async (input) => embedTextLocal(input, config.dimensions)
      }, config);
    case OLLAMA_EMBEDDING_PROVIDER:
      return validatedProvider(createOllamaEmbeddingProvider(config), config);
    default:
      throw new EmbeddingProviderError(
        "unsupported_provider",
        config.provider,
        `Embedding provider '${config.provider}' is not available in this build.`
      );
  }
}

function validatedProvider(provider: EmbeddingProvider, config: EmbeddingConfig): EmbeddingProvider {
  if (provider.id !== config.provider || provider.model !== config.model || provider.dimensions !== config.dimensions) {
    throw new EmbeddingProviderError(
      "invalid_config",
      config.provider,
      `Embedding provider factory returned ${provider.id}/${provider.model}/${provider.dimensions}; expected ${config.provider}/${config.model}/${config.dimensions}.`
    );
  }
  return provider;
}

export function embeddingCapability(provider: string): "lexical-hash" | "semantic-model" | "unknown" {
  if (provider === LOCAL_EMBEDDING_PROVIDER) {
    return "lexical-hash";
  }
  if (provider === OLLAMA_EMBEDDING_PROVIDER) {
    return "semantic-model";
  }
  return registeredProviders.get(provider)?.capability ?? "unknown";
}

export function registerEmbeddingProvider(
  id: string,
  capability: EmbeddingProvider["capability"],
  factory: EmbeddingProviderFactory
): () => void {
  const normalizedId = id.trim();
  if (!normalizedId) {
    throw new Error("Embedding provider id must not be empty.");
  }
  if (SUPPORTED_EMBEDDING_PROVIDERS.includes(normalizedId as typeof SUPPORTED_EMBEDDING_PROVIDERS[number]) || registeredProviders.has(normalizedId)) {
    throw new Error(`Embedding provider '${normalizedId}' is already registered.`);
  }
  const registration = { capability, factory };
  registeredProviders.set(normalizedId, registration);
  return () => {
    if (registeredProviders.get(normalizedId) === registration) {
      registeredProviders.delete(normalizedId);
    }
  };
}

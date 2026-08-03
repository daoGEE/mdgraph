import type { GraphChunk, ChunkVector, MDGraphConfig } from "../types.js";
import { createEmbeddingProvider } from "./provider-registry.js";
import { EmbeddingProviderError, validateEmbeddingVector } from "./provider.js";
import { DEFAULT_EMBEDDING_BATCH_SIZE } from "./ollama-provider.js";

export async function embedChunks(chunks: GraphChunk[], config: MDGraphConfig): Promise<ChunkVector[]> {
  if (!config.embedding.enabled || !chunks.length) {
    return [];
  }

  const provider = createEmbeddingProvider(config.embedding);
  const batchSize = config.embedding.batchSize ?? DEFAULT_EMBEDDING_BATCH_SIZE;
  const createdAt = new Date().toISOString();
  const vectors: ChunkVector[] = [];

  for (let offset = 0; offset < chunks.length; offset += batchSize) {
    const batch = chunks.slice(offset, offset + batchSize);
    const embedded = await provider.embedDocuments(batch.map((chunk) => chunk.content));
    if (embedded.length !== batch.length) {
      throw new EmbeddingProviderError(
        "invalid_response",
        provider.id,
        `Embedding provider '${provider.id}' returned ${embedded.length} vector(s) for ${batch.length} chunk(s).`
      );
    }
    embedded.forEach((vector, index) => {
      validateEmbeddingVector(provider.id, vector, config.embedding.dimensions);
      vectors.push({
        chunkId: batch[index].id,
        provider: provider.id,
        model: provider.model,
        dimensions: provider.dimensions,
        vector,
        createdAt
      });
    });
  }

  return vectors;
}

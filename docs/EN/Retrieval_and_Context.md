---
title: Retrieval and Context
type: guide
status: active
source_refs:
  - src/query/search.ts
  - src/query/context-builder.ts
  - src/extraction/entity-extractor.ts
  - src/semantic/provider.ts
  - src/semantic/ollama-provider.ts
---

# Retrieval and Context

MDGraph combines deterministic full-text, entity, and graph retrieval by default. A real embedding provider and true Maximal Marginal Relevance (MMR) context packing are available as explicit options; neither is required to index or query a project.

## Search Channels

`search` combines and deduplicates four explainable channels:

- FTS5 chunk matches, with lightweight CJK n-gram augmentation for continuous Chinese, Japanese, and Korean text.
- Exact technical-entity matches.
- Graph neighbors around matching entities and documents.
- Optional embedding-vector matches when a supported provider is enabled, indexed, and requested.

Reciprocal rank fusion (RRF) combines the active channels. Results retain reasons, matched entities, edge provenance, and optional semantic provider/model metadata. Semantic results are an additional signal; they do not replace the deterministic channels.

## Semantic Providers

Embedding support is provider-based. The default configuration keeps embeddings disabled.

| Provider | Capability | Intended use |
|---|---|---|
| `local-hash` | `lexical-hash` | Compatibility and deterministic lexical projection. It is not a language-model embedding and should not be treated as synonym understanding. |
| `ollama` | `semantic-model` | Opt-in local semantic retrieval through a separately running Ollama service and embedding model. |

Example Ollama configuration:

```json
{
  "embedding": {
    "enabled": true,
    "provider": "ollama",
    "model": "nomic-embed-text",
    "dimensions": 768,
    "endpoint": "http://127.0.0.1:11434",
    "timeoutMs": 30000,
    "batchSize": 16
  }
}
```

Build a complete provider-backed index before semantic queries:

```bash
mdgraph index --full --semantic --path /path/to/project
mdgraph semantic status --path /path/to/project
mdgraph search --semantic --path /path/to/project "authentication login"
```

Provider identity, model, dimensions, and vector coverage are stored with the index. Changing that profile requires a full semantic reindex. Embedding finishes before a repository write begins, so provider failure cannot commit partial graph or vector coverage.

At query time, an unavailable provider, timeout, invalid response, missing model, or incomplete vector profile falls back to FTS5/entity/graph retrieval. CLI and MCP outputs include an additive `semanticDiagnostic`; a usable lexical result is not converted into an error.

## Deterministic Entity Extraction

Entity extraction is source-aware and favors precision. It is an interpretable heuristic, not general-purpose named-entity recognition and not a programming-language AST.

| Source | Inferred technical signals |
|---|---|
| Front matter and `Defines` / `定义` sections | Explicit definitions, including names otherwise suppressed by the stop list. |
| Technical headings | API routes, Latin symbols, shaped configuration keys, and empty-call function forms. |
| Ordinary prose | API routes, error codes, shaped uppercase or dotted configuration keys, and segmented CJK configuration keys. |
| Standalone inline code | Structured signals plus a complete Latin or CJK symbol value. |
| Fenced code | Structured signals, empty-call functions, declaration names, and bounded type-reference contexts. |
| Markdown and WikiLinks | Structured link signals; WikiLink labels must look like a complete entity. |

Broad PascalCase scanning is intentionally absent from prose and code blocks. This avoids promoting words such as “The”, “When”, and “Note” to graph nodes. `entities.stopEntities` suppresses every inferred reference kind; author-declared definitions remain authoritative.

Unicode-aware rules recognize CJK API paths such as `POST /接口/登录`, segmented keys such as `登录.认证.重试`, and empty-call identifiers such as `验证登录()` or `認証を確認()`. Route boundaries prevent a file path such as `src/auth/session.ts` from also emitting the truncated route `/auth/session.ts`. Bare CJK prose is not inferred as an entity without explicit structural evidence.

## Context Packing

`context` starts from ranked search sections, performs bounded graph expansion through non-containment edges, and packs selected sections under a character budget.

The compatibility default, `mmr-style-document-round-robin`, introduces documents in round-robin order. It is deterministic and preserves existing behavior, but it does not calculate pairwise relevance and redundancy.

True MMR is opt-in:

```bash
mdgraph context --packing mmr --mmr-lambda 0.65 --debug --json \
  --path /path/to/project "session recovery"
```

MCP callers select the same behavior with `packingStrategy: "mmr"` and may provide `mmrLambda`. At each selection step, MMR maximizes:

```text
lambda * queryRelevance - (1 - lambda) * maximumSimilarityToSelected
```

Candidate similarity uses stored vectors for the configured provider/model when both chunks have them. Otherwise it uses deterministic Unicode-token Jaccard similarity. Same-document candidates at least `0.8` similar to an already selected section are pruned, while the first candidate from another document is preserved as cross-document evidence.

Every result includes `packing` metadata. `--debug` additionally reports candidate and graph-expansion counts, similarity source, lambda, per-item relevance and redundancy scores, pruned duplicates, and budget truncation.

## Limits and Evaluation

- CJK n-grams improve lexical matching but do not provide morphology, word segmentation, translation, or synonym understanding.
- Entity rules recognize bounded technical shapes; projects should use explicit front matter for authoritative domain entities.
- Embedding quality depends on the chosen model and target corpus. Repository fixtures verify integration behavior, not universal model quality.
- MMR reduces measured redundancy on the repository fixture, but its best lambda and similarity threshold remain corpus-dependent.

See [Evaluation](Evaluation_Questions.md) for public `eval` commands, regression suites, and the limits of the recorded evidence. See [Operations](Operations.md) for index freshness and provider failure recovery.

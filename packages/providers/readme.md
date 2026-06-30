# packages/providers

LLM provider adapters. Each adapter translates between resolv's internal `Message`/`ToolDefinition` types and the provider's wire format.

## Adding a new provider

1. Create `packages/providers/<name>/<name>-provider.ts`
2. Implement the `Provider` interface from `provider.ts`
3. Register it in `register.ts`
4. Add stable provider metadata to `PROVIDER_INFO` in `config/config.ts`

## Provider interface

```ts
interface Provider {
  readonly name: string;
  readonly defaultModel: string;
  healthCheck?(model?: string): Promise<void>;
  listModels?(): Promise<string[]>;
  chat(options: ProviderChatOptions & { model?: string }): Promise<ProviderResponse>;
  embed(texts: string[], model?: string): Promise<number[][]>;
}
```

## Model discovery

Providers should implement `listModels()` when the upstream API or local runtime exposes a catalog. The CLI uses that for `/model`, `/provider`, and setup. If discovery fails, the CLI asks for a manual model name instead of showing a hardcoded list.

Current discovery paths:

| Provider family | Source |
|-----------------|--------|
| OpenAI, Grok, OpenRouter, NIM | OpenAI-compatible `/models` response |
| Anthropic | Anthropic SDK Models API |
| Google Gemini | Google Generative Language models endpoint |
| Ollama | Local `/api/tags` |

## Streaming behavior

The OpenAI-compatible provider adapters keep the request alive while streaming response chunks arrive. Slow but active streaming responses from OpenRouter, Grok, NIM, and OpenAI are less likely to fail due to a fixed timeout.

`embed` is optional in practice — providers that don't support it should throw `EmbeddingsNotSupportedError`, which the semantic search code catches and handles by falling back to keyword matching.

## Files

| File | Provider |
|------|---------|
| `anthropic/anthropic-provider.ts` | Anthropic Messages API (Claude) |
| `google/gemini-provider.ts` | Google Gemini via `@google/generative-ai` |
| `nim/nim-provider.ts` | NVIDIA NIM (OpenAI-compatible endpoint) |
| `ollama/ollama_provider.ts` | Ollama local LLM (streaming, OpenAI-compatible) |
| `openai-compat/base-provider.ts` | Shared OpenAI-compatible chat, health, and model listing |
| `provider.ts` | The `Provider` interface + `EmbeddingsNotSupportedError` |
| `register.ts` | Factory: builds a provider from config or env vars |

## Config vs env

`register.ts` exposes two factory functions:

- `createProviderFromConfig(config)` — takes an already-loaded `ResolvConfig` (preferred)
- `createProviderFromEnv(config?)` — reads env vars, optionally merged with a config object

The REPL and solve command both pass the loaded config object to avoid re-reading disk on every call.

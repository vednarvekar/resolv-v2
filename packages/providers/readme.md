# packages/providers

LLM provider adapters. Each adapter translates between resolv's internal `Message`/`ToolDefinition` types and the provider's wire format.

## Adding a new provider

1. Create `packages/providers/<name>/<name>-provider.ts`
2. Implement the `Provider` interface from `provider.ts`
3. Register it in `register.ts`
4. Add it to `PROVIDER_INFO` in `config/config.ts`

## Provider interface

```ts
interface Provider {
  readonly name: string;
  readonly defaultModel: string;
  chat(options: ProviderChatOptions & { model?: string }): Promise<ProviderResponse>;
  embed(texts: string[], model?: string): Promise<number[][]>;
}
```

`embed` is optional in practice — providers that don't support it should throw `EmbeddingsNotSupportedError`, which the semantic search code catches and handles by falling back to keyword matching.

## Files

| File | Provider |
|------|---------|
| `anthropic/anthropic-provider.ts` | Anthropic Messages API (Claude) |
| `google/gemini-provider.ts` | Google Gemini via `@google/generative-ai` |
| `nim/nim-provider.ts` | NVIDIA NIM (OpenAI-compatible endpoint) |
| `ollama/ollama_provider.ts` | Ollama local LLM (streaming, OpenAI-compatible) |
| `provider.ts` | The `Provider` interface + `EmbeddingsNotSupportedError` |
| `register.ts` | Factory: builds a provider from config or env vars |

## Config vs env

`register.ts` exposes two factory functions:

- `createProviderFromConfig(config)` — takes an already-loaded `ResolvConfig` (preferred)
- `createProviderFromEnv(config?)` — reads env vars, optionally merged with a config object

The REPL and solve command both pass the loaded config object to avoid re-reading disk on every call.
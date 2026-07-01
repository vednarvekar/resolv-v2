// packages/providers/openai/openai-provider.ts
// OpenAI GPT provider — uses the shared OpenAI-compatible base.

import { OpenAICompatProvider } from "../openai-compat/base-provider.js";

export class OpenAIProvider extends OpenAICompatProvider {
  constructor(apiKey: string, model?: string) {
    super({
      apiKey,
      baseUrl: "https://api.openai.com/v1",
      providerName: "openai",
      defaultModel: model ?? "gpt-4o",
      defaultEmbeddingModel: "text-embedding-3-small",
      defaultTemperature: undefined,
      defaultMaxTokens: 4096,
      requestTimeoutMs: 120_000,
    });
  }
}

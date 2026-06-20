// packages/providers/grok/grok-provider.ts
// xAI Grok provider — OpenAI-compatible API at api.x.ai

import { OpenAICompatProvider } from "../openai-compat/base-provider.js";

export class GrokProvider extends OpenAICompatProvider {
  constructor(apiKey: string, model?: string) {
    super({
      apiKey,
      baseUrl: "https://api.x.ai/v1",
      providerName: "grok",
      defaultModel: model ?? "grok-3-mini",
      defaultTemperature: 0.3,
      defaultMaxTokens: 8192,
      requestTimeoutMs: 120_000,
    });
  }
}
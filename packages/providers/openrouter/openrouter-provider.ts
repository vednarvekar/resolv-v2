// packages/providers/openrouter/openrouter-provider.ts
// OpenRouter — one API key, access to 200+ models from every major provider.
// OpenAI-compatible endpoint at openrouter.ai/api/v1
// Required headers: HTTP-Referer and X-Title for attribution.

import { ProviderError } from "../../core/errors.js";
import { OpenAICompatProvider } from "../openai-compat/base-provider.js";

export class OpenRouterProvider extends OpenAICompatProvider {
  constructor(apiKey: string, model?: string) {
    super({
      apiKey,
      baseUrl: "https://openrouter.ai/api/v1",
      providerName: "openrouter",
      defaultModel: model ?? "anthropic/claude-sonnet-4-6",
      defaultEmbeddingModel: undefined, // OpenRouter doesn't expose embeddings
      defaultTemperature: 0.3,
      defaultMaxTokens: 4096,
      requestTimeoutMs: 120_000,
      // OpenRouter prefers standard Referer and X-Title attribution headers.
      extraHeaders: {
        Referer: "https://github.com/vednarvekar/resolv",
        "X-Title": "resolv",
      },
    });
  }

  /** OpenRouter health check: validate the API key/model with a minimal chat request. */
  override async healthCheck(model?: string): Promise<void> {
    const url = `${this.cfg.baseUrl}/chat/completions`;
    const body = {
      model: model ?? this.defaultModel,
      messages: [{ role: "user", content: "Health check" }],
      max_tokens: 1,
      temperature: 0,
      stream: false,
    };

    const res = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    }, 10_000);

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new ProviderError(
        `OpenRouter health check failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`,
        "openrouter",
        res.status
      );
    }
  }
}
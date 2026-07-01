import Anthropic from "@anthropic-ai/sdk";
import { ProviderError } from "../../core/errors.js";
import type { ProviderChatOptions } from "../../core/types.js";
import { EmbeddingsNotSupportedError, type Provider } from "../provider.js";
import { fromAnthropicResponse, toAnthropicMessages, toAnthropicTools } from "./anthropic-wire.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";

export class AnthropicProvider implements Provider {
  readonly name = "anthropic";
  readonly defaultModel: string;
  private readonly client: Anthropic;

  constructor(apiKey: string, model?: string) {
    this.defaultModel = model ?? DEFAULT_MODEL;
    this.client = new Anthropic({ apiKey });
  }

  async healthCheck(model?: string): Promise<void> {
    try {
      if (model) await this.client.models.retrieve(model);
      else await this.client.models.list({ limit: 1 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ProviderError(`Anthropic health check failed: ${message}`, "anthropic");
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const ids: string[] = [];
      for await (const model of this.client.models.list()) {
        ids.push(model.id);
      }
      return ids;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ProviderError(`Anthropic model list failed: ${message}`, "anthropic");
    }
  }

  async chat(options: ProviderChatOptions & { model?: string }): Promise<ProviderResponse> {
    try {
      const stream = this.client.messages.stream({
        model: options.model ?? this.defaultModel,
        max_tokens: options.maxTokens ?? 2048,
        temperature: options.temperature ?? 0.2,
        system: options.systemPrompt,
        messages: toAnthropicMessages(options.messages),
        tools: options.tools && options.tools.length > 0 ? toAnthropicTools(options.tools) : undefined,
      });
      stream.on("text", (text) => options.onTextDelta?.(text));
      const raw = await stream.finalMessage();
      return fromAnthropicResponse(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ProviderError(`Anthropic request failed: ${message}`, "anthropic");
    }
  }

  async embed(): Promise<number[][]> {
    // Anthropic doesn't offer a public embeddings endpoint as of this writing.
    // Callers (semantic search) must catch this and fall back to keyword search.
    throw new EmbeddingsNotSupportedError("anthropic");
  }
}

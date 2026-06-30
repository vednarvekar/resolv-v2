// The single interface the rest of resolv depends on. Provider-specific SDKs
// stay behind this boundary.

import type { ProviderChatOptions, ProviderResponse } from "../core/types.js";

export interface Provider {
  /** Short identifier used in logs/config, e.g. "anthropic" or "openrouter". */
  readonly name: string;

  /** Model used when config does not provide one. */
  readonly defaultModel: string;

  /** Checks reachability and, when supplied, model availability. */
  healthCheck?(model?: string): Promise<void>;

  /** Lists models available to the configured provider key or local runtime. */
  listModels?(): Promise<string[]>;

  /** Sends a chat request and translates the provider response into resolv's shape. */
  chat(options: ProviderChatOptions & { model?: string }): Promise<ProviderResponse>;

  /** Generates embeddings, or throws EmbeddingsNotSupportedError when unavailable. */
  embed(texts: string[], model?: string): Promise<number[][]>;
}

export class EmbeddingsNotSupportedError extends Error {
  constructor(providerName: string) {
    super(`Provider "${providerName}" does not support embedding.`);
    this.name = "EmbeddingsNotSupportedError";
  }
}

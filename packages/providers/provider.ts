// ============================================================
// resolv — providers/provider.ts
// The single interface the entire rest of the system depends on.
// agent-loop.ts never imports NIM/Anthropic/Gemini SDKs directly —
// it only ever talks to this interface. Swapping providers is a
// config change (RESOLV_PROVIDER=anthropic), not a code change.
// ============================================================

import type { ProviderChatOptions, ProviderResponse } from "../core/types.js"

export interface Provider {

    /** short identifier used in logs/config, e.g. "nim", "anthropic", "google" */
    readonly name: string;
 
    /** human-readable default model string this provider will use if none is specified */
    readonly defaultModel: string;

    /** Checks that the provider is reachable and, when supplied, the model is available. */
    healthCheck?(model?: string): Promise<void>;

    /** Lists models available to the configured provider key. */
    listModels?(): Promise<string[]>;
 
    /**
    * Sends a chat completion request. Implementations are responsible for
    * translating the provider-agnostic Message[]/ToolDefinition[] shape into
    * whatever their underlying API expects, and translating the response
    * back into ProviderResponse.
    */
    chat(options: ProviderChatOptions & { model?: string }): Promise<ProviderResponse>

    /**
    * Generates embeddings for semantic search. Optional — not every provider
    * needs to support this (e.g. a provider used purely for chat could throw
    * "not supported" here and the system falls back to keyword search).
    */
    embed(texts: string[], model?: string): Promise<number[][]>;
}

export class EmbeddingsNotSupportedError extends Error {
    constructor(providerName: string) {
        super(`Provider "${providerName}" does not support embedding.`)
        this.name="EmbeddingNotSupportError";
    }
}

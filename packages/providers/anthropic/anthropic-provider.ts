// ============================================================
// resolv — providers/anthropic/anthropic-provider.ts
// Translates between resolv's provider-agnostic Message/ToolDefinition
// types and the Anthropic Messages API's native tool-use format.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { ProviderError } from "../../core/errors.js";
import type {
  ContentBlock,
  Message,
  ProviderChatOptions,
  ProviderResponse,
  ToolDefinition,
} from "../../core/types.js";
import type { Provider } from "../provider.js";
import { EmbeddingsNotSupportedError } from "../provider.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";

// ── translation: resolv Message[] -> Anthropic message[] ────

function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "system") continue; // system goes in the top-level `system` field instead

    if (msg.role === "tool") {
      const blocks: Anthropic.ToolResultBlockParam[] = msg.content
        .filter((b): b is { type: "tool_result"; toolUseId: string; content: string; isError: boolean } => b.type === "tool_result")
        .map((b) => ({
          type: "tool_result",
          tool_use_id: b.toolUseId,
          content: b.content,
          is_error: b.isError,
        }));
      out.push({ role: "user", content: blocks });
      continue;
    }

    const content: Anthropic.ContentBlockParam[] = msg.content.map((block): Anthropic.ContentBlockParam => {
      if (block.type === "text") return { type: "text", text: block.text };
      if (block.type === "tool_use") {
        return { type: "tool_use", id: block.id, name: block.name, input: block.input };
      }
      // tool_result shouldn't appear on non-"tool" roles, but satisfy the type checker
      return { type: "text", text: "" };
    });

    out.push({ role: msg.role === "assistant" ? "assistant" : "user", content });
  }

  return out;
}

function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
  }));
}

// ── translation: Anthropic response -> resolv ProviderResponse ─

function fromAnthropicResponse(raw: Anthropic.Message): ProviderResponse {
  const content: ContentBlock[] = raw.content.map((block): ContentBlock => {
    if (block.type === "text") return { type: "text", text: block.text };
    if (block.type === "tool_use") {
      return { type: "tool_use", id: block.id, name: block.name, input: block.input as Record<string, unknown> };
    }
    return { type: "text", text: "" };
  });

  const stopReason: ProviderResponse["stopReason"] =
    raw.stop_reason === "tool_use"
      ? "tool_use"
      : raw.stop_reason === "max_tokens"
        ? "max_tokens"
        : "end_turn";

  return {
    message: { role: "assistant", content },
    stopReason,
    usage: { inputTokens: raw.usage.input_tokens, outputTokens: raw.usage.output_tokens },
  };
}

// ── the provider ─────────────────────────────────────────────

export class AnthropicProvider implements Provider {
  readonly name = "anthropic";
  readonly defaultModel = DEFAULT_MODEL;
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
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

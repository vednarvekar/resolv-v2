import Anthropic from "@anthropic-ai/sdk";

import type { ContentBlock, Message, ProviderResponse, ToolDefinition } from "../../core/types.js";

export function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "system") continue;

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
      return { type: "text", text: "" };
    });

    out.push({ role: msg.role === "assistant" ? "assistant" : "user", content });
  }

  return out;
}

export function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
  }));
}

export function fromAnthropicResponse(raw: Anthropic.Message): ProviderResponse {
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

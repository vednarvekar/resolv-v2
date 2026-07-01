import { ProviderError } from "../../core/errors.js";
import type {
  ContentBlock,
  Message,
  ProviderResponse,
  ToolDefinition,
} from "../../core/types.js";

interface OAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OAIToolCall[];
  tool_call_id?: string;
}

interface OAIStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

interface OAIResponse {
  choices?: Array<{
    message: OAIMessage;
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

function modelId(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;

  const item = value as { id?: unknown; name?: unknown; model?: unknown };
  if (typeof item.id === "string") return item.id;
  if (typeof item.name === "string") return item.name;
  if (typeof item.model === "string") return item.model;
  return undefined;
}

export function extractModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];

  const roots = Array.isArray(payload)
    ? [payload]
    : [payload as { data?: unknown; models?: unknown }].flatMap((body) => [body.data, body.models]);

  const ids = roots
    .filter(Array.isArray)
    .flatMap((items) => items.map(modelId))
    .filter((id): id is string => Boolean(id));

  return Array.from(new Set(ids)).sort();
}

export function toOAIMessages(messages: Message[], systemPrompt?: string): OAIMessage[] {
  const out: OAIMessage[] = [];
  if (systemPrompt) out.push({ role: "system", content: systemPrompt });

  for (const msg of messages) {
    if (msg.role === "system") continue;

    if (msg.role === "tool") {
      for (const block of msg.content) {
        if (block.type === "tool_result") {
          out.push({ role: "tool", content: block.content, tool_call_id: block.toolUseId });
        }
      }
      continue;
    }

    const textParts = msg.content.filter((b): b is { type: "text"; text: string } => b.type === "text");
    const toolUseParts = msg.content.filter((b) => b.type === "tool_use");

    if (msg.role === "assistant" && toolUseParts.length > 0) {
      out.push({
        role: "assistant",
        content: textParts.length > 0 ? textParts.map((t) => t.text).join("\n") : null,
        tool_calls: toolUseParts.map((b) => {
          const block = b as { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
          return {
            id: block.id,
            type: "function" as const,
            function: { name: block.name, arguments: JSON.stringify(block.input) },
          };
        }),
      });
      continue;
    }

    out.push({
      role: msg.role as "user" | "assistant",
      content: textParts.map((t) => t.text).join("\n"),
    });
  }

  return out;
}

export function toOAITools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

export function fromOAIResponse(raw: OAIResponse, providerName: string): ProviderResponse {
  const choice = raw.choices?.[0];
  if (!choice) throw new ProviderError(`${providerName} response contained no choices`, providerName);

  const content: ContentBlock[] = [];
  if (choice.message.content) content.push({ type: "text", text: choice.message.content });

  for (const call of choice.message.tool_calls ?? []) {
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(call.function.arguments);
    } catch {
      input = {};
    }
    content.push({ type: "tool_use", id: call.id, name: call.function.name, input });
  }

  const stopReason: ProviderResponse["stopReason"] =
    choice.finish_reason === "tool_calls" ? "tool_use"
    : choice.finish_reason === "length" ? "max_tokens"
    : "end_turn";

  return {
    message: { role: "assistant", content },
    stopReason,
    usage: raw.usage
      ? { inputTokens: raw.usage.prompt_tokens, outputTokens: raw.usage.completion_tokens }
      : undefined,
  };
}

export function shouldRetryWithMaxCompletionTokens(errText: string): boolean {
  return /unsupported parameter/i.test(errText)
    && /max_tokens/i.test(errText)
    && /max_completion_tokens/i.test(errText);
}

export function shouldRetryWithoutTemperature(errText: string): boolean {
  return /unsupported value/i.test(errText) && /temperature/i.test(errText);
}

export type { OAIResponse, OAIMessage, OAIToolCall, OAIStreamChunk };

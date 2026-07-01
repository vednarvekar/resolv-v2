import fs from "node:fs";

import { ProviderError } from "../../core/errors.js";
import type { ContentBlock, Message, ProviderResponse, ToolDefinition } from "../../core/types.js";

const DEFAULT_MODEL = "deepseek-r1:8b";
const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";

export function getOllamaBaseUrl(): string {
  return (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
}

export function isWsl(): boolean {
  if (process.platform !== "linux") return false;
  try {
    return /microsoft|wsl/i.test(fs.readFileSync("/proc/sys/kernel/osrelease", "utf8"));
  } catch {
    return false;
  }
}

export function connectionError(baseUrl: string, cause: unknown): ProviderError {
  const detail = cause instanceof Error ? ` (${cause.message})` : "";
  const wslHelp = isWsl() && /127\.0\.0\.1|localhost/.test(baseUrl)
    ? " WSL cannot reach a Windows-only localhost listener in NAT mode. Enable WSL mirrored networking, or expose Ollama on the Windows host and set OLLAMA_BASE_URL to that host address."
    : " Check that Ollama is running and that OLLAMA_BASE_URL points to its reachable address.";
  return new ProviderError(`Unable to connect to Ollama at ${baseUrl}.${detail}${wslHelp}`, "ollama");
}

export async function ollamaFetch(path: string, init?: RequestInit): Promise<Response> {
  const baseUrl = getOllamaBaseUrl();
  try {
    return await fetch(`${baseUrl}${path}`, init);
  } catch (cause) {
    throw connectionError(baseUrl, cause);
  }
}

export interface OllamaToolCall {
  id?: string;
  type: "function";
  function: { name: string; arguments: string | Record<string, unknown> };
}

export interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OllamaToolCall[];
  tool_call_id?: string;
}

export interface OllamaChatResponse {
  choices?: {
    message: OllamaMessage & { reasoning_content?: string };
    finish_reason: string;
  }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export interface OllamaStreamDelta {
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    type?: "function";
    function?: { name?: string; arguments?: string };
  }>;
}

export interface OllamaStreamChunk {
  choices?: Array<{
    delta?: OllamaStreamDelta;
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export function stripReasoning(content: string): string {
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .trim();
}

export function fromOllamaResponse(raw: OllamaChatResponse): ProviderResponse {
  const choice = raw.choices?.[0];
  if (!choice) throw new ProviderError("Ollama response contained no choices", "ollama");

  const content: ContentBlock[] = [];
  const answer = stripReasoning(choice.message.content ?? "");
  if (answer) content.push({ type: "text", text: answer });

  for (const [index, call] of (choice.message.tool_calls ?? []).entries()) {
    let input: Record<string, unknown> = {};
    if (typeof call.function.arguments === "string") {
      try {
        const parsed: unknown = JSON.parse(call.function.arguments);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          input = parsed as Record<string, unknown>;
        }
      } catch {
        // Let the tool report missing/invalid arguments without killing the session.
      }
    } else if (call.function.arguments && typeof call.function.arguments === "object") {
      input = call.function.arguments;
    }

    content.push({
      type: "tool_use",
      id: call.id || `ollama-tool-${index}`,
      name: call.function.name,
      input,
    });
  }

  const stopReason: ProviderResponse["stopReason"] =
    choice.finish_reason === "tool_calls" || choice.message.tool_calls?.length
      ? "tool_use"
      : choice.finish_reason === "length"
        ? "max_tokens"
        : "end_turn";

  return {
    message: { role: "assistant", content },
    stopReason,
    usage: raw.usage
      ? { inputTokens: raw.usage.prompt_tokens, outputTokens: raw.usage.completion_tokens }
      : undefined,
  };
}

export function toOllamaMessage(messages: Message[], systemPrompt?: string): OllamaMessage[] {
  const out: OllamaMessage[] = [];
  if (systemPrompt) out.push({ role: "system", content: systemPrompt });

  for (const msg of messages) {
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
      role: msg.role as "user" | "assistant" | "system",
      content: textParts.map((t) => t.text).join("\n"),
    });
  }

  return out;
}

export function toOllamaTools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

export const OLLAMA_DEFAULT_MODEL = DEFAULT_MODEL;
export const OLLAMA_DEFAULT_EMBEDDING_MODEL = DEFAULT_EMBEDDING_MODEL;

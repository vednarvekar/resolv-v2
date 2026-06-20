// packages/providers/openai-compat/base-provider.ts
// Shared implementation for any OpenAI-compatible chat completions API.
// Used by: OpenAI, Grok (xAI), OpenRouter, NVIDIA NIM.
// Each concrete provider subclasses this and sets the endpoint + defaults.

import { ProviderError } from "../../core/errors.js";
import type {
  ContentBlock,
  Message,
  ProviderChatOptions,
  ProviderResponse,
  ToolDefinition,
} from "../../core/types.js";
import type { Provider } from "../provider.js";

export interface OpenAICompatConfig {
  apiKey: string;
  baseUrl: string;
  providerName: string;
  defaultModel: string;
  defaultEmbeddingModel?: string;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  requestTimeoutMs?: number;
  healthCheckUrl?: string;
  /** Extra headers to add to every request (e.g. OpenRouter HTTP-Referer) */
  extraHeaders?: Record<string, string>;
}

// ── Wire types ───────────────────────────────────────────────

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

// ── Translation helpers ──────────────────────────────────────

function toOAIMessages(messages: Message[], systemPrompt?: string): OAIMessage[] {
  const out: OAIMessage[] = [];
  if (systemPrompt) out.push({ role: "system", content: systemPrompt });

  for (const msg of messages) {
    if (msg.role === "system") continue; // already handled above

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

function toOAITools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema, // note: "parameters" not "parameter"
    },
  }));
}

function fromOAIResponse(raw: OAIResponse, providerName: string): ProviderResponse {
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

// ── Base class ───────────────────────────────────────────────

export abstract class OpenAICompatProvider implements Provider {
  readonly name: string;
  readonly defaultModel: string;
  protected readonly cfg: OpenAICompatConfig;

  constructor(cfg: OpenAICompatConfig) {
    this.cfg = cfg;
    this.name = cfg.providerName;
    this.defaultModel = cfg.defaultModel;
  }

  protected get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...this.cfg.extraHeaders,
    };
  }

  private createAbortController(timeoutMs: number) {
    const controller = new AbortController();
    let timer = setTimeout(() => controller.abort(), timeoutMs);

    return {
      controller,
      reset: () => {
        clearTimeout(timer);
        timer = setTimeout(() => controller.abort(), timeoutMs);
      },
      clear: () => clearTimeout(timer),
    };
  }

  protected async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const { controller, clear } = this.createAbortController(timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        throw new ProviderError(
          `${this.name} request timed out after ${Math.round(timeoutMs / 1000)}s`,
          this.name
        );
      }
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new ProviderError(`Cannot reach ${this.name} at ${url}: ${detail}`, this.name);
    } finally {
      clear();
    }
  }

  private async formatResponseDetail(res: Response): Promise<string> {
    const text = await res.text().catch(() => "");
    if (!text) return "";

    try {
      const json = JSON.parse(text);
      if (json?.error) {
        if (typeof json.error === "string") return json.error;
        if (typeof json.error?.message === "string") return json.error.message;
        if (typeof json.error?.reason === "string") return json.error.reason;
      }
      if (typeof json?.message === "string") return json.message;
      if (typeof json?.detail === "string") return json.detail;
      return JSON.stringify(json);
    } catch {
      return text;
    }
  }

  async healthCheck(model?: string): Promise<void> {
    const url = this.cfg.healthCheckUrl ?? `${this.cfg.baseUrl}/models`;
    const res = await this.fetchWithTimeout(url, { headers: this.headers }, 10_000);
    if (!res.ok) {
      const detail = await this.formatResponseDetail(res);
      throw new ProviderError(
        `${this.name} health check failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`,
        this.name,
        res.status
      );
    }
    if (!model) return;

    // Check model availability if the models endpoint returns a list
    try {
      const payload = (await res.json()) as { data?: Array<{ id?: string }> };
      if (payload?.data?.length && !payload.data.some((m) => m.id === model)) {
        throw new ProviderError(`${this.name}: model "${model}" is not available for this API key.`, this.name);
      }
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      // If the endpoint doesn't return a standard model list, just skip the check
    }
  }

  async chat(options: ProviderChatOptions & { model?: string }): Promise<ProviderResponse> {
    const timeoutMs = this.cfg.requestTimeoutMs ?? 120_000;
    const url = `${this.cfg.baseUrl}/chat/completions`;

    const body: Record<string, unknown> = {
      model: options.model ?? this.defaultModel,
      messages: toOAIMessages(options.messages, options.systemPrompt),
      temperature: options.temperature ?? (this.cfg.defaultTemperature ?? 0.3),
      max_tokens: options.maxTokens ?? (this.cfg.defaultMaxTokens ?? 4096),
      stream: true,
      stream_options: { include_usage: true },
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = toOAITools(options.tools);
    }

    const controllerInfo = this.createAbortController(timeoutMs);
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
      signal: controllerInfo.controller.signal,
    });

    if (!res.ok) {
      const errText = await this.formatResponseDetail(res);
      controllerInfo.clear();
      throw new ProviderError(`${this.name} request failed (HTTP ${res.status}): ${errText}`, this.name, res.status);
    }

    if (!res.body) {
      controllerInfo.clear();
      throw new ProviderError(`${this.name}: empty response body`, this.name);
    }

    // Stream processing
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const pendingToolCalls = new Map<number, { id: string; name: string; arguments: string }>();
    let responseText = "";
    let finishReason = "stop";
    let usage: OAIResponse["usage"];
    let buffer = "";

    const processLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") return;
      const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trimStart() : trimmed;
      let chunk: OAIStreamChunk;
      try { chunk = JSON.parse(payload) as OAIStreamChunk; } catch { return; }

      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (!choice) return;
      if (choice.finish_reason) finishReason = choice.finish_reason;

      const text = choice.delta?.content ?? "";
      responseText += text;
      if (text) options.onTextDelta?.(text);

      for (const [pos, call] of (choice.delta?.tool_calls ?? []).entries()) {
        const idx = call.index ?? pos;
        const cur = pendingToolCalls.get(idx) ?? { id: "", name: "", arguments: "" };
        if (call.id) cur.id += call.id;
        if (call.function?.name) cur.name += call.function.name;
        if (call.function?.arguments) cur.arguments += call.function.arguments;
        pendingToolCalls.set(idx, cur);
      }
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        controllerInfo.reset();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) processLine(line);
      }
      if (buffer.trim()) processLine(buffer);
    } finally {
      controllerInfo.clear();
    }

    const raw: OAIResponse = {
      choices: [{
        message: {
          role: "assistant",
          content: responseText,
          tool_calls: [...pendingToolCalls.entries()]
            .sort(([a], [b]) => a - b)
            .filter(([, c]) => c.name)
            .map(([i, c]) => ({ id: c.id || `${this.name}-tool-${i}`, type: "function", function: { name: c.name, arguments: c.arguments || "{}" } })),
        },
        finish_reason: finishReason,
      }],
      usage,
    };

    return fromOAIResponse(raw, this.name);
  }

  async embed(texts: string[], model?: string): Promise<number[][]> {
    if (!this.cfg.defaultEmbeddingModel) {
      throw new ProviderError(`${this.name} embeddings are not configured`, this.name);
    }

    const url = `${this.cfg.baseUrl}/embeddings`;
    const results: number[][] = [];
    const BATCH = 32;

    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts.slice(i, i + BATCH);
      const res = await this.fetchWithTimeout(url, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ model: model ?? this.cfg.defaultEmbeddingModel, input: batch }),
      }, 30_000);

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new ProviderError(`${this.name} embedding request failed: ${errText}`, this.name, res.status);
      }

      const data = (await res.json()) as { data?: { embedding: number[]; index: number }[] };
      const sorted = (data.data ?? []).sort((a, b) => a.index - b.index);
      for (const item of sorted) results.push(item.embedding);
    }

    return results;
  }
}
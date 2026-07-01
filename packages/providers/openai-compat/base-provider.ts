// packages/providers/openai-compat/base-provider.ts
// Shared implementation for any OpenAI-compatible chat completions API.
// Used by: OpenAI, Grok (xAI), OpenRouter, NVIDIA NIM.
// Each concrete provider subclasses this and sets the endpoint + defaults.

import { ProviderError } from "../../core/errors.js";
import type { ProviderChatOptions, ProviderResponse } from "../../core/types.js";
import type { Provider } from "../provider.js";
import {
  extractModelIds,
  fromOAIResponse,
  shouldRetryWithMaxCompletionTokens,
  shouldRetryWithoutTemperature,
  toOAIMessages,
  toOAITools,
  type OAIResponse,
  type OAIStreamChunk,
} from "./oai-wire.js";

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

  async listModels(): Promise<string[]> {
    const url = this.cfg.healthCheckUrl ?? `${this.cfg.baseUrl}/models`;
    const res = await this.fetchWithTimeout(url, { headers: this.headers }, 10_000);
    if (!res.ok) {
      const detail = await this.formatResponseDetail(res);
      throw new ProviderError(
        `${this.name} model list failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`,
        this.name,
        res.status
      );
    }

    const payload = await res.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      throw new ProviderError(`${this.name}: model list response was not valid JSON`, this.name);
    }

    const candidates = extractModelIds(payload);

    if (candidates.length === 0) {
      throw new ProviderError(`${this.name}: unable to discover available models from provider response`, this.name);
    }

    return candidates;
  }

  async chat(options: ProviderChatOptions & { model?: string }): Promise<ProviderResponse> {
    const timeoutMs = this.cfg.requestTimeoutMs ?? 120_000;
    const url = `${this.cfg.baseUrl}/chat/completions`;
    const bodyBase: Record<string, unknown> = {
      model: options.model ?? this.defaultModel,
      messages: toOAIMessages(options.messages, options.systemPrompt),
      stream: true,
      stream_options: { include_usage: true },
    };

    if (options.tools && options.tools.length > 0) {
      bodyBase.tools = toOAITools(options.tools);
    }

    const send = async (
      tokenField: "max_tokens" | "max_completion_tokens",
      includeTemperature: boolean,
    ): Promise<ProviderResponse> => {
      const controllerInfo = this.createAbortController(timeoutMs);
      const temperature = options.temperature ?? this.cfg.defaultTemperature;
      const body = {
        ...bodyBase,
        [tokenField]: options.maxTokens ?? (this.cfg.defaultMaxTokens ?? 4096),
        ...(includeTemperature && temperature !== undefined ? { temperature } : {}),
      };

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
        try {
          chunk = JSON.parse(payload) as OAIStreamChunk;
        } catch {
          return;
        }

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
    };

    try {
      return await send("max_tokens", true);
    } catch (err) {
      if (err instanceof ProviderError && err.statusCode === 400 && shouldRetryWithMaxCompletionTokens(err.message)) {
        return await send("max_completion_tokens", true);
      }
      if (err instanceof ProviderError && err.statusCode === 400 && shouldRetryWithoutTemperature(err.message)) {
        try {
          return await send("max_tokens", false);
        } catch (retryErr) {
          if (retryErr instanceof ProviderError && retryErr.statusCode === 400 && shouldRetryWithMaxCompletionTokens(retryErr.message)) {
            return await send("max_completion_tokens", false);
          }
          throw retryErr;
        }
      }
      throw err;
    }
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

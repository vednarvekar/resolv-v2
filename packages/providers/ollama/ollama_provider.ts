import { ProviderError } from "../../core/errors.js";
import type { ProviderChatOptions, ProviderResponse } from "../../core/types.js";
import type { Provider } from "../provider.js";
import {
    fromOllamaResponse,
    OLLAMA_DEFAULT_EMBEDDING_MODEL,
    OLLAMA_DEFAULT_MODEL,
    ollamaFetch,
    type OllamaStreamChunk,
    toOllamaMessage,
    toOllamaTools,
} from "./ollama-wire.js";

const MAX_EMBEDDING_BATCH = 32;

// ── the provider ─────────────────────────────────────────────

export class OllamaProvider implements Provider {
    readonly name = "ollama";
    readonly defaultModel = OLLAMA_DEFAULT_MODEL;

    async healthCheck(model?: string): Promise<void> {
        const models = await this.listModels();
        if (!model) return;
        if (!models.includes(model)) {
            throw new ProviderError(`Ollama model "${model}" is not installed. Run: ollama pull ${model}`, "ollama");
        }
    }

    async listModels(): Promise<string[]> {
        const response = await ollamaFetch("/api/tags", { signal: AbortSignal.timeout(3000) });
        if (!response.ok) {
            throw new ProviderError(`Ollama model list failed with HTTP ${response.status}`, "ollama", response.status);
        }

        const data = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
        return Array.from(new Set(
            (data.models ?? [])
                .map((item) => item.name ?? item.model)
                .filter((name): name is string => Boolean(name))
        )).sort();
    }

    async chat(options: ProviderChatOptions & { model?: string }): Promise<ProviderResponse> {
        const body: Record<string, unknown> = {
            model: options.model ?? this.defaultModel,
            messages: toOllamaMessage(options.messages, options.systemPrompt),
            temperature: options.temperature ?? 0.5,
            max_tokens: options.maxTokens ?? 2048,
            stream: true,
            stream_options: { include_usage: true },
        };

        if (options.tools && options.tools.length > 0) {
            body.tools = toOllamaTools(options.tools);
        }

        const response = await ollamaFetch("/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => "");
            throw new ProviderError(`Ollama request failed: ${errText}`, "ollama", response.status);
        }

        if (!response.body) {
            throw new ProviderError("Ollama response body is empty or unstreamable", "ollama");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const streamedToolCalls = new Map<number, { id: string; name: string; arguments: string }>();
        let responseText = "";
        let finishReason = "stop";
        let usage: { prompt_tokens: number; completion_tokens: number } | undefined;
        let buffer = "";

        const consumeLine = (line: string): void => {
            const trimmed = line.trim();
            if (!trimmed || trimmed === "data: [DONE]") return;
            const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trimStart() : trimmed;

            let chunk: OllamaStreamChunk;
            try {
                chunk = JSON.parse(payload) as OllamaStreamChunk;
            } catch {
                return;
            }

            if (chunk.usage) usage = chunk.usage;
            const choice = chunk.choices?.[0];
            if (!choice) return;
            if (choice.finish_reason) finishReason = choice.finish_reason;

            const delta = choice.delta;
            if (!delta) return;
            const text = delta.content ?? "";
            responseText += text;
            if (text) options.onTextDelta?.(text);

            for (const [position, call] of (delta.tool_calls ?? []).entries()) {
                const index = call.index ?? position;
                const current = streamedToolCalls.get(index) ?? { id: "", name: "", arguments: "" };
                if (call.id) current.id += call.id;
                if (call.function?.name) current.name += call.function.name;
                if (call.function?.arguments) current.arguments += call.function.arguments;
                streamedToolCalls.set(index, current);
            }
        };

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? "";
            for (const line of lines) consumeLine(line);
        }
        buffer += decoder.decode();
        if (buffer.trim()) consumeLine(buffer);

        const raw = {
            choices: [{
                message: {
                    role: "assistant",
                    content: responseText,
                    tool_calls: [...streamedToolCalls.entries()]
                        .sort(([a], [b]) => a - b)
                        .filter(([, call]) => call.name)
                        .map(([index, call]) => ({
                            id: call.id || `ollama-tool-${index}`,
                            type: "function" as const,
                            function: { name: call.name, arguments: call.arguments || "{}" },
                        })),
                },
                finish_reason: finishReason,
            }],
            usage,
        };
        return fromOllamaResponse(raw);
    }

    async embed(texts: string[], model?: string): Promise<number[][]> {
        const results: number[][] = [];

        for (let i = 0; i < texts.length; i += MAX_EMBEDDING_BATCH) {
            const batch = texts.slice(i, i + MAX_EMBEDDING_BATCH);

            // Accessing Ollama's local OpenAI compatible embedding route
            const response = await ollamaFetch("/v1/embeddings", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json"
                },
                body: JSON.stringify({
                    model: model ?? OLLAMA_DEFAULT_EMBEDDING_MODEL,
                    input: batch,
                })
            });

            if (!response.ok) {
                const errText = await response.text().catch(() => "");
                throw new ProviderError(`Ollama embedding request failed: ${errText}`, "ollama", response.status);
            }

            const data = (await response.json()) as { data?: { embedding: number[]; index: number }[] };
            const sorted = (data.data ?? []).sort((a, b) => a.index - b.index);
            for (const item of sorted) results.push(item.embedding);
        }

        return results;
    }
}

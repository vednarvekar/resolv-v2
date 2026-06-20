// ============================================================
// resolv — providers/ollama/ollama-provider.ts
// Ollama exposes a local OpenAI-compatible chat completions API.
// This handles translating between the local wire format and
// resolv's provider-agnostic Message/ToolDefinition types.
// ============================================================

import { ProviderError } from "../../core/errors.js";
import fs from "node:fs";
import type {
    ContentBlock,
    Message,
    ProviderChatOptions,
    ProviderResponse,
    ToolDefinition,
} from "../../core/types.js";
import type { Provider } from "../provider.js";

const DEFAULT_MODEL = "deepseek-r1:8b";
const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text"; // Common lightweight local embedding model
const MAX_EMBEDDING_BATCH = 32;

function getOllamaBaseUrl(): string {
    return (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
}

function isWsl(): boolean {
    if (process.platform !== "linux") return false;
    try {
        return /microsoft|wsl/i.test(fs.readFileSync("/proc/sys/kernel/osrelease", "utf8"));
    } catch {
        return false;
    }
}

function connectionError(baseUrl: string, cause: unknown): ProviderError {
    const detail = cause instanceof Error ? ` (${cause.message})` : "";
    const wslHelp = isWsl() && /127\.0\.0\.1|localhost/.test(baseUrl)
        ? " WSL cannot reach a Windows-only localhost listener in NAT mode. Enable WSL mirrored networking, or expose Ollama on the Windows host and set OLLAMA_BASE_URL to that host address."
        : " Check that Ollama is running and that OLLAMA_BASE_URL points to its reachable address.";
    return new ProviderError(`Unable to connect to Ollama at ${baseUrl}.${detail}${wslHelp}`, "ollama");
}

async function ollamaFetch(path: string, init?: RequestInit): Promise<Response> {
    const baseUrl = getOllamaBaseUrl();
    try {
        return await fetch(`${baseUrl}${path}`, init);
    } catch (cause) {
        throw connectionError(baseUrl, cause);
    }
}

interface OpenAiToolCall {
    id?: string;
    type: "function";
    function: { name: string; arguments: string | Record<string, unknown> };
}

interface OpenAiMessage {
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    tool_calls?: OpenAiToolCall[];
    tool_call_id?: string;
}

interface OpenAiChatResponse {
    choices?: {
        message: OpenAiMessage & { reasoning_content?: string };
        finish_reason: string;
    }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
}

interface OpenAiStreamDelta {
    content?: string | null;
    reasoning_content?: string | null;
    tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: "function";
        function?: { name?: string; arguments?: string };
    }>;
}

interface OpenAiStreamChunk {
    choices?: Array<{
        delta?: OpenAiStreamDelta;
        finish_reason?: string | null;
    }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
}

function stripReasoning(content: string): string {
    return content
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .replace(/<think>[\s\S]*$/gi, "")
        .trim();
}

function fromOpenAiResponse(raw: OpenAiChatResponse): ProviderResponse {
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

// ── translation: resolv Message[] -> OpenAI message[] ───────

function toOpenAiMessage(messages: Message[], systemPrompt?: string): OpenAiMessage[] {
    const out: OpenAiMessage[] = [];
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
                        function: { name: block.name, arguments: JSON.stringify(block.input) }
                    };
                })
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

function toOpenAiTools(tools: ToolDefinition[]) {
    return tools.map((t) => ({
        type: "function" as const,
        function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema // Corrected from 'parameter' to match spec
        }
    }));
}

// ── the provider ─────────────────────────────────────────────

export class OllamaProvider implements Provider {
    readonly name = "ollama";
    readonly defaultModel = DEFAULT_MODEL;

    async healthCheck(model?: string): Promise<void> {
        const response = await ollamaFetch("/api/tags", { signal: AbortSignal.timeout(3000) });
        if (!response.ok) {
            throw new ProviderError(`Ollama health check failed with HTTP ${response.status}`, "ollama", response.status);
        }

        if (!model) return;
        const data = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
        const installed = data.models?.some((item) => item.name === model || item.model === model) ?? false;
        if (!installed) {
            throw new ProviderError(`Ollama model "${model}" is not installed. Run: ollama pull ${model}`, "ollama");
        }
    }

    async chat(options: ProviderChatOptions & { model?: string }): Promise<ProviderResponse> {
        const body: Record<string, unknown> = {
            model: options.model ?? this.defaultModel,
            messages: toOpenAiMessage(options.messages, options.systemPrompt),
            temperature: options.temperature ?? 0.5,
            max_tokens: options.maxTokens ?? 2048,
            stream: true,
            stream_options: { include_usage: true },
        };

        if (options.tools && options.tools.length > 0) {
            body.tools = toOpenAiTools(options.tools);
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
        const streamedToolCalls = new Map<number, {
            id: string;
            name: string;
            arguments: string;
        }>();
        let responseText = "";
        let finishReason = "stop";
        let usage: OpenAiChatResponse["usage"];
        let buffer = "";

        const consumeLine = (line: string): void => {
            const trimmed = line.trim();
            if (!trimmed || trimmed === "data: [DONE]") return;
            const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trimStart() : trimmed;

            let chunk: OpenAiStreamChunk;
            try {
                chunk = JSON.parse(payload) as OpenAiStreamChunk;
            } catch {
                return;
            }

            if (chunk.usage) usage = chunk.usage;
            const choice = chunk.choices?.[0];
            if (!choice) return;
            if (choice.finish_reason) finishReason = choice.finish_reason;

            const delta = choice.delta;
            if (!delta) return;
            // DeepSeek may send private reasoning separately. Deliberately do
            // not merge it into content consumed by parsers or conversation history.
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

        const toolCalls: OpenAiToolCall[] = [...streamedToolCalls.entries()]
            .sort(([a], [b]) => a - b)
            .filter(([, call]) => call.name)
            .map(([index, call]) => ({
                id: call.id || `ollama-tool-${index}`,
                type: "function",
                function: { name: call.name, arguments: call.arguments || "{}" },
            }));

        const raw: OpenAiChatResponse = {
            choices: [{
                message: { role: "assistant", content: responseText, tool_calls: toolCalls },
                finish_reason: finishReason,
            }],
            usage,
        };
        return fromOpenAiResponse(raw);
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
                    model: model ?? DEFAULT_EMBEDDING_MODEL,
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

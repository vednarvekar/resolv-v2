// ============================================================
// resolv — providers/nim/nim-provider.ts
// NVIDIA NIM speaks the OpenAI-compatible chat completions + embeddings
// format. This file's only job is translating between that wire format
// and resolv's provider-agnostic Message/ToolDefinition types.
// ============================================================

import { ProviderError } from "../../core/errors.js"
import type {
    ContentBlock,
    Message,
    ProviderChatOptions,
    ProviderResponse,
    ToolDefinition,
} from "../../core/types.js"
import type { Provider } from "../provider.js"


const NIM_CHAT_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";
const NIM_EMBEDDING_ENDPOINT = "https://integrate.api.nvidia.com/v1/embeddings";
const NIM_MODELS_ENDPOINT = "https://integrate.api.nvidia.com/v1/models";
const DEFAULT_MODEL = "google/gemma-4-31b-it";
const DEFAULT_EMBEDDING_MODEL = "nvidia/nv-embedqa-e5-v5";
const MAX_EMBEDDING_BATCH = 32;
const DEFAULT_REQUEST_TIMEOUT_MS = 90_000;
const HEALTH_CHECK_TIMEOUT_MS = 10_000;

function requestTimeoutMs(): number {
    const configured = Number.parseInt(process.env.NIM_REQUEST_TIMEOUT_MS ?? "", 10);
    return Number.isFinite(configured) && configured >= 5_000 ? configured : DEFAULT_REQUEST_TIMEOUT_MS;
}

function fetchFailureMessage(cause: unknown, timeoutMs: number): string {
    if (cause instanceof DOMException && cause.name === "TimeoutError") {
        return `NVIDIA NIM request timed out after ${Math.round(timeoutMs / 1000)} seconds`;
    }
    const error = cause instanceof Error ? cause : undefined;
    const nested = error?.cause as { code?: string; message?: string } | undefined;
    const detail = nested?.code ?? nested?.message ?? error?.message ?? String(cause);
    return `Could not reach NVIDIA NIM (${detail}). Check DNS, proxy/VPN, firewall, and access to integrate.api.nvidia.com`;
}

async function nimFetch(url: string, init: RequestInit, timeoutMs = requestTimeoutMs()): Promise<Response> {
    try {
        return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (cause) {
        throw new ProviderError(fetchFailureMessage(cause, timeoutMs), "nim");
    }
}


interface OpenAiToolCall {
    id: string
    type: "function"
    function: { name: string; arguments: string }
}

interface OpenAiMessage {
    role: "system" | "user" | "assistant" | "tool"
    content: string | null
    tool_calls?: OpenAiToolCall[]
    tool_call_id?: string
}

interface OpenAiChatResponse {
    choices?: {
        message: OpenAiMessage
        finish_reason: string
    }[];
    usage?: { prompt_tokens: number; completion_tokens: number }; 
}

interface OpenAiStreamChunk {
    choices?: Array<{
        delta?: {
            content?: string | null
            tool_calls?: Array<{
                index?: number
                id?: string
                function?: { name?: string; arguments?: string }
            }>
        }
        finish_reason?: string | null
    }>
    usage?: { prompt_tokens: number; completion_tokens: number }
}

// ── translation: resolv Message[] -> OpenAI message[] ───────

function toOpenAiMessage(message: Message[], systemPrompt?: string): OpenAiMessage[] {
    const out: OpenAiMessage[] = []
    if(systemPrompt) out.push({ role: "system", content: systemPrompt })

    for(const msg of message) {
        if(msg.role === "tool"){
            for(const block of msg.content){
                if(block.type === "tool_result"){
                    out.push({ role: "tool", content: block.content, tool_call_id: block.toolUseId })
                }
            }
            continue
        }

        const textParts = msg.content.filter((b): b is { type: "text"; text: string } => b.type === "text");
        const toolUseParts = msg.content.filter((b) => b.type === "tool_use")

        if(msg.role === "assistant" && toolUseParts.length > 0) {
            out.push({
                role: "assistant",
                content: textParts.length > 0 ? textParts.map((t) => t.text).join("\n") : null,
                tool_calls: toolUseParts.map((b) => {
                    const block = b as { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
                    return {
                        id: block.id,
                        type: "function" as const,
                        function: { name: block.name, arguments: JSON.stringify(block.input) }
                    }
                })
            })
            continue
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
            parameters: t.inputSchema
        }
    }))
}

// ── translation: OpenAI response -> resolv ProviderResponse ─

function fromOpenAiResponse(raw: OpenAiChatResponse): ProviderResponse {
    const choice = raw.choices?.[0]
    if(!choice){
        throw new ProviderError("NIM response contained no choices", "nim")
    }

    const content: ContentBlock[] = []

    if(choice.message.content){
        content.push({ type: "text", text: choice.message.content })
    }

    for(const call of choice.message.tool_calls ?? []){
        let input: Record<string, unknown>
        try {
            input = JSON.parse(call.function.arguments)
        } catch {
            // model produced malformed JSON args — pass through empty input rather
            // than crashing; the tool's own validation will report the problem
            input = {}
        }
        content.push({ type: "tool_use", id: call.id, name: call.function.name, input })
    }

    const stopReason: ProviderResponse["stopReason"] = 
        choice.finish_reason === "tool_calls"
            ? "tool_use"
            : choice.finish_reason === "length"
                ? "max_tokens"
                : "end_turn";

    return {
        message: {role: "assistant", content},
        stopReason,
        usage: raw.usage
            ? { inputTokens: raw.usage.prompt_tokens, outputTokens: raw.usage.completion_tokens }
            : undefined
    }
}

// ── the provider ─────────────────────────────────────────────

export class NimProvider implements Provider {
    readonly name = "nim"
    readonly defaultModel = DEFAULT_MODEL

    constructor(private readonly apiKey: string) {}

    async healthCheck(model?: string): Promise<void> {
        const response = await nimFetch(NIM_MODELS_ENDPOINT, {
            headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
        }, HEALTH_CHECK_TIMEOUT_MS);

        if (!response.ok) {
            const detail = await response.text().catch(() => "");
            throw new ProviderError(
                `NVIDIA NIM health check failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
                "nim",
                response.status
            );
        }

        if (!model) return;
        const payload = (await response.json().catch(() => null)) as { data?: Array<{ id?: string }> } | null;
        if (payload?.data?.length && !payload.data.some((item) => item.id === model)) {
            throw new ProviderError(`NVIDIA NIM model "${model}" is not available for this API key.`, "nim");
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
        }

        if(options.tools && options.tools.length > 0){
            body.tools = toOpenAiTools(options.tools)
        }

        const response = await nimFetch(NIM_CHAT_ENDPOINT, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify(body)
        })

        if(!response.ok) {
            const errText = await response.text().catch(() => "")
            throw new ProviderError(`NIM request failed: ${errText}`, "nim", response.status)
        }

        if (!response.body) {
            throw new ProviderError("NIM response body is empty or unstreamable", "nim");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
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

            const text = choice.delta?.content ?? "";
            responseText += text;
            if (text) options.onTextDelta?.(text);

            for (const [position, call] of (choice.delta?.tool_calls ?? []).entries()) {
                const index = call.index ?? position;
                const current = toolCalls.get(index) ?? { id: "", name: "", arguments: "" };
                if (call.id) current.id += call.id;
                if (call.function?.name) current.name += call.function.name;
                if (call.function?.arguments) current.arguments += call.function.arguments;
                toolCalls.set(index, current);
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

        const raw: OpenAiChatResponse = {
            choices: [{
                message: {
                    role: "assistant",
                    content: responseText,
                    tool_calls: [...toolCalls.entries()]
                        .sort(([a], [b]) => a - b)
                        .filter(([, call]) => call.name)
                        .map(([index, call]) => ({
                            id: call.id || `nim-tool-${index}`,
                            type: "function",
                            function: { name: call.name, arguments: call.arguments || "{}" },
                        })),
                },
                finish_reason: finishReason,
            }],
            usage,
        };
        return fromOpenAiResponse(raw)
    }

    async embed(texts: string[], model?: string): Promise<number[][]> {
        const results: number[][] = [];

        for(let i = 0; i < texts.length; i += MAX_EMBEDDING_BATCH) {
            const batch = texts.slice(i, i + MAX_EMBEDDING_BATCH)

            const response = await nimFetch(NIM_EMBEDDING_ENDPOINT, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    "Content-Type": "application/json",
                    Accept: "application/json"
                },
                body: JSON.stringify({
                    model: model ?? DEFAULT_EMBEDDING_MODEL,
                    input: batch,
                    input_type: "passage",
                })
            });

            if(!response.ok){
                const errText = await response.text().catch(() => "")
                throw new ProviderError(`NIM embedding request failed: ${errText}`, "nim", response.status);
            }
 
            const data = (await response.json()) as { data?: { embedding: number[]; index: number }[] };
            const sorted = (data.data ?? []).sort((a, b) => a.index - b.index);
            for (const item of sorted) results.push(item.embedding);
        }   

        return results;
    }
}

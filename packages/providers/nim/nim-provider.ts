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
const DEFAULT_MODEL = "deepseek-ai/deepseek-v4-pro";
const DEFAULT_EMBEDDING_MODEL = "nvidia/nv-embedqa-e5-v5";
const MAX_EMBEDDING_BATCH = 32;


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
            parameter: t.inputSchema
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

    async chat(options: ProviderChatOptions & { model?: string }): Promise<ProviderResponse> {
        const body: Record<string, unknown> = {
            model: options.model ?? this.defaultModel,
            messages: toOpenAiMessage(options.messages, options.systemPrompt),
            temperature: options.temperature ?? 0.5,
            max_tokens: options.maxTokens ?? 2048,
            stream: false,
        }

        if(options.tools && options.tools.length > 0){
            body.tools = toOpenAiTools(options.tools)
        }

        const response = await fetch(NIM_CHAT_ENDPOINT, {
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

        const raw = (await response.json()) as OpenAiChatResponse;
        return fromOpenAiResponse(raw)
    }

    async embed(texts: string[], model?: string): Promise<number[][]> {
        const results: number[][] = [];

        for(let i = 0; i < texts.length; i += MAX_EMBEDDING_BATCH) {
            const batch = texts.slice(i, i + MAX_EMBEDDING_BATCH)

            const response = await fetch(NIM_EMBEDDING_ENDPOINT, {
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
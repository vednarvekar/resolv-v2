// ============================================================
// resolv — providers/google/gemini-provider.ts
// Translates between resolv's provider-agnostic Message/ToolDefinition
// types and the Gemini SDK's function-calling format.
// ============================================================

import {
  GoogleGenerativeAI,
  type Content,
  type FunctionDeclaration,
  type FunctionDeclarationSchema,
  type Part,
  type Schema,
  SchemaType,
} from "@google/generative-ai";
import { ProviderError } from "../../core/errors.js";
import type {
  ContentBlock,
  JSONSchemaProperty,
  Message,
  ProviderChatOptions,
  ProviderResponse,
  ToolDefinition,
} from "../../core/types.js";
import type { Provider } from "../provider.js";

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-004";

// ── translation: resolv JSONSchema -> Gemini SchemaType ─────

function toGeminiType(jsonType: JSONSchemaProperty["type"]): SchemaType {
  switch (jsonType) {
    case "string": return SchemaType.STRING;
    case "number": return SchemaType.NUMBER;
    case "boolean": return SchemaType.BOOLEAN;
    case "array": return SchemaType.ARRAY;
    case "object": return SchemaType.OBJECT;
  }
}

function toGeminiTools(tools: ToolDefinition[]): FunctionDeclaration[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: {
      type: SchemaType.OBJECT,
      properties: Object.fromEntries(
        Object.entries(t.inputSchema.properties).map(([key, prop]) => [
          key,
          {
            type: toGeminiType(prop.type),
            description: prop.description,
            enum: prop.enum,
            items: prop.items ? { type: toGeminiType(prop.items.type) } : undefined,
          } as Schema,
        ])
      ),
      required: t.inputSchema.required,
    } as FunctionDeclarationSchema,
  }));
}

// ── translation: resolv Message[] -> Gemini Content[] ───────
// Gemini has no separate "tool" role — tool results go in a "function" part
// inside a "user" turn (a quirk specific to this API).

function toGeminiContents(messages: Message[]): Content[] {
  const out: Content[] = [];

  for (const msg of messages) {
    if (msg.role === "system") continue; // handled via systemInstruction instead

    if (msg.role === "tool") {
      const parts: Part[] = msg.content
        .filter((b): b is { type: "tool_result"; toolUseId: string; content: string; isError: boolean } => b.type === "tool_result")
        .map((b) => ({
          functionResponse: {
            name: b.toolUseId, // Gemini matches by function name, not call id — see note in chat()
            response: { result: b.content, isError: b.isError },
          },
        }));
      out.push({ role: "user", parts });
      continue;
    }

    const parts: Part[] = msg.content.map((block): Part => {
      if (block.type === "text") return { text: block.text };
      if (block.type === "tool_use") {
        return { functionCall: { name: block.name, args: block.input } };
      }
      return { text: "" };
    });

    out.push({ role: msg.role === "assistant" ? "model" : "user", parts });
  }

  return out;
}

// ── the provider ─────────────────────────────────────────────

export class GeminiProvider implements Provider {
  readonly name = "google";
  readonly defaultModel = DEFAULT_MODEL;
  private readonly client: GoogleGenerativeAI;

  constructor(private readonly apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async chat(options: ProviderChatOptions & { model?: string }): Promise<ProviderResponse> {
    try {
      const model = this.client.getGenerativeModel({
        model: options.model ?? this.defaultModel,
        systemInstruction: options.systemPrompt,
        tools: options.tools && options.tools.length > 0 ? [{ functionDeclarations: toGeminiTools(options.tools) }] : undefined,
        generationConfig: {
          temperature: options.temperature ?? 0.2,
          maxOutputTokens: options.maxTokens ?? 2048,
        },
      });

      const result = await model.generateContent({ contents: toGeminiContents(options.messages) });
      const candidate = result.response.candidates?.[0];
      if (!candidate) throw new ProviderError("Gemini response contained no candidates", "google");

      const content: ContentBlock[] = [];
      // Gemini's tool_use ids aren't stable across the call/result pair the way
      // OpenAI/Anthropic's are, so we synthesize one from the function name +
      // position. This is a known limitation specific to this provider.
      let callIndex = 0;
      for (const part of candidate.content.parts) {
        if (part.text) content.push({ type: "text", text: part.text });
        if (part.functionCall) {
          content.push({
            type: "tool_use",
            id: `${part.functionCall.name}_${callIndex++}`,
            name: part.functionCall.name,
            input: part.functionCall.args as Record<string, unknown>,
          });
        }
      }

      const hasToolCall = content.some((b) => b.type === "tool_use");
      const stopReason: ProviderResponse["stopReason"] = hasToolCall
        ? "tool_use"
        : candidate.finishReason === "MAX_TOKENS"
          ? "max_tokens"
          : "end_turn";

      return {
        message: { role: "assistant", content },
        stopReason,
        usage: result.response.usageMetadata
          ? {
              inputTokens: result.response.usageMetadata.promptTokenCount,
              outputTokens: result.response.usageMetadata.candidatesTokenCount,
            }
          : undefined,
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new ProviderError(`Gemini request failed: ${message}`, "google");
    }
  }

  async embed(texts: string[], model?: string): Promise<number[][]> {
    try {
      const embedModel = this.client.getGenerativeModel({ model: model ?? DEFAULT_EMBEDDING_MODEL });
      const results: number[][] = [];
      for (const text of texts) {
        const res = await embedModel.embedContent(text);
        results.push(res.embedding.values);
      }
      return results;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ProviderError(`Gemini embedding request failed: ${message}`, "google");
    }
  }
}
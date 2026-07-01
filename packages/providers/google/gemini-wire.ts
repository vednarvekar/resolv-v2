import {
  SchemaType,
  type Content,
  type FunctionDeclaration,
  type FunctionDeclarationSchema,
  type Part,
  type Schema,
} from "@google/generative-ai";

import { ProviderError } from "../../core/errors.js";
import type { ContentBlock, JSONSchemaProperty, Message, ProviderResponse, ToolDefinition } from "../../core/types.js";

const DEFAULT_EMBEDDING_MODEL = "text-embedding-004";

function toGeminiType(jsonType: JSONSchemaProperty["type"]): SchemaType {
  switch (jsonType) {
    case "string": return SchemaType.STRING;
    case "number": return SchemaType.NUMBER;
    case "boolean": return SchemaType.BOOLEAN;
    case "array": return SchemaType.ARRAY;
    case "object": return SchemaType.OBJECT;
  }
}

export function toGeminiTools(tools: ToolDefinition[]): FunctionDeclaration[] {
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

export function toGeminiContents(messages: Message[]): Content[] {
  const out: Content[] = [];

  for (const msg of messages) {
    if (msg.role === "system") continue;

    if (msg.role === "tool") {
      const parts: Part[] = msg.content
        .filter((b): b is { type: "tool_result"; toolUseId: string; content: string; isError: boolean } => b.type === "tool_result")
        .map((b) => ({
          functionResponse: {
            name: b.toolUseId,
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

export function fromGeminiResponse(response: {
  candidates?: Array<{
    content: { parts: Array<{ text?: string; functionCall?: { name: string; args: unknown } }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
  };
}): ProviderResponse {
  const candidate = response.candidates?.[0];
  if (!candidate) throw new ProviderError("Gemini response contained no candidates", "google");

  const content: ContentBlock[] = [];
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
  return {
    message: { role: "assistant", content },
    stopReason: hasToolCall
      ? "tool_use"
      : candidate.finishReason === "MAX_TOKENS"
        ? "max_tokens"
        : "end_turn",
    usage: response.usageMetadata
      ? {
          inputTokens: response.usageMetadata.promptTokenCount,
          outputTokens: response.usageMetadata.candidatesTokenCount,
        }
      : undefined,
  };
}

export const GEMINI_DEFAULT_EMBEDDING_MODEL = DEFAULT_EMBEDDING_MODEL;

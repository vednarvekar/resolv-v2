import {
  GoogleGenerativeAI,
} from "@google/generative-ai";
import { ProviderError } from "../../core/errors.js";
import type { ProviderChatOptions, ProviderResponse } from "../../core/types.js";
import type { Provider } from "../provider.js";
import {
  fromGeminiResponse,
  GEMINI_DEFAULT_EMBEDDING_MODEL,
  toGeminiContents,
  toGeminiTools,
} from "./gemini-wire.js";

const DEFAULT_MODEL = "gemini-2.5-flash";
const MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export class GeminiProvider implements Provider {
  readonly name = "google";
  readonly defaultModel: string;
  private readonly client: GoogleGenerativeAI;

  constructor(private readonly apiKey: string, model?: string) {
    this.defaultModel = model ?? DEFAULT_MODEL;
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async healthCheck(model?: string): Promise<void> {
    const models = await this.listModels();
    if (model && !models.includes(model)) {
      throw new ProviderError(`Gemini model "${model}" is not available for this API key.`, "google");
    }
  }

  async listModels(): Promise<string[]> {
    const url = `${MODELS_URL}?key=${encodeURIComponent(this.apiKey)}`;
    let response: Response;
    try {
      response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ProviderError(`Cannot reach Gemini model list: ${message}`, "google");
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new ProviderError(
        `Gemini model list failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`,
        "google",
        response.status
      );
    }

    const payload = (await response.json()) as {
      models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
    };

    return (payload.models ?? [])
      .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
      .map((model) => model.name?.replace(/^models\//, ""))
      .filter((name): name is string => Boolean(name))
      .sort();
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

      const result = await model.generateContentStream({ contents: toGeminiContents(options.messages) });
      for await (const chunk of result.stream) {
        for (const part of chunk.candidates?.[0]?.content.parts ?? []) {
          if (part.text) options.onTextDelta?.(part.text);
        }
      }
      const response = await result.response;
      return fromGeminiResponse(response);
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new ProviderError(`Gemini request failed: ${message}`, "google");
    }
  }

  async embed(texts: string[], model?: string): Promise<number[][]> {
    try {
      const embedModel = this.client.getGenerativeModel({ model: model ?? GEMINI_DEFAULT_EMBEDDING_MODEL });
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

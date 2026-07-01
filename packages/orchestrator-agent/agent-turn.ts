import { AgentEventBus } from "../core/events.js";
import {
  Msg,
  type Message,
  type ProviderChatOptions,
  type ProviderResponse,
  type ToolUseContentBlock,
} from "../core/types.js";
import { chatWithTransientRetries } from "../llm/chat-with-retries.js";
import type { Provider } from "../providers/provider.js";
import { ToolRegistry } from "./tool-registry.js";

export interface ModelTurnOptions {
  provider: Provider;
  model?: string;
  messages: readonly Message[];
  tools: ToolRegistry;
  systemPrompt: string;
  events?: AgentEventBus;
  temperature?: number;
  maxTokens?: number;
}

export interface AssistantContent {
  textBlocks: Array<{ type: "text"; text: string }>;
  toolUseBlocks: ToolUseContentBlock[];
}

export async function requestModelTurn(options: ModelTurnOptions): Promise<{
  response: ProviderResponse;
  streamedText: boolean;
}> {
  let streamedText = false;

  const response = await chatWithTransientRetries(
    options.provider,
    {
      messages: [...options.messages],
      tools: options.tools.list(),
      systemPrompt: options.systemPrompt,
      model: options.model,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      onTextDelta: (text) => {
        if (!text) return;
        streamedText = true;
        options.events?.emit({ type: "text_delta", text });
      },
    } satisfies ProviderChatOptions & { model?: string },
    {
      retries: 2,
      onAttempt: () => {
        options.events?.emit({ type: "model_start", providerName: options.provider.name });
      },
      onRetry: (attempt, error) => {
        options.events?.emit({
          type: "provider_retry",
          attempt,
          maxAttempts: 3,
          message: error.message,
        });
      },
    },
  );

  return { response, streamedText };
}

export function getAssistantContent(response: ProviderResponse): AssistantContent {
  return {
    textBlocks: response.message.content.filter((b): b is { type: "text"; text: string } => b.type === "text"),
    toolUseBlocks: response.message.content.filter((b): b is ToolUseContentBlock => b.type === "tool_use"),
  };
}

export function ensureVisibleAssistantContent(response: ProviderResponse, content: AssistantContent): void {
  const hasRealContent =
    content.toolUseBlocks.length > 0 || content.textBlocks.some((b) => b.text.trim().length > 0);

  if (hasRealContent) return;

  const reason = response.stopReason ? ` (stop reason: ${response.stopReason})` : "";
  response.message.content = [{
    type: "text",
    text: `[No response content received from the model${reason}. Small models often don't support tool calling reliably - try a larger model, or check /provider.]`,
  }];
}

export function emitBufferedAssistantText(
  response: ProviderResponse,
  streamedText: boolean,
  events?: AgentEventBus,
): void {
  if (streamedText) return;

  for (const block of response.message.content) {
    if (block.type === "text" && block.text) {
      events?.emit({ type: "text_delta", text: block.text });
    }
  }
}

export function collectAssistantText(response: ProviderResponse): string {
  return response.message.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

export async function executeToolCalls(
  toolUseBlocks: ToolUseContentBlock[],
  tools: ToolRegistry,
  events?: AgentEventBus,
): Promise<Message[]> {
  const resultMessages: Message[] = [];

  for (const block of toolUseBlocks) {
    events?.emit({
      type: "tool_call_start",
      toolName: block.name,
      toolUseId: block.id,
      input: block.input,
    });

    const tool = tools.get(block.name);
    if (!tool) {
      const errorOutput = `No tool named "${block.name}" is registered.`;
      events?.emit({
        type: "tool_call_end",
        toolName: block.name,
        toolUseId: block.id,
        output: errorOutput,
        isError: true,
      });
      resultMessages.push(Msg.toolResult(block.id, errorOutput, true));
      continue;
    }

    try {
      const result = await tool.execute(block.input);
      events?.emit({
        type: "tool_call_end",
        toolName: block.name,
        toolUseId: block.id,
        output: result.output,
        isError: result.isError,
      });
      resultMessages.push(Msg.toolResult(block.id, result.output, result.isError));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      events?.emit({
        type: "tool_call_end",
        toolName: block.name,
        toolUseId: block.id,
        output: message,
        isError: true,
      });
      resultMessages.push(Msg.toolResult(block.id, `Tool threw: ${message}`, true));
    }
  }

  return resultMessages;
}

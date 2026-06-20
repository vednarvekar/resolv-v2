// Core conversational agent loop.
// - System prompt sent ONCE (first turn only). Provider APIs maintain their own
//   conversation memory server-side; resending the system prompt every turn
//   wastes tokens and can cause context drift.
// - Emits AgentEvents for the TUI to render without coupling to it.
// - Tool-call round-trips continue until the model produces plain text or the cap is hit.

import { AgentEventBus } from "../core/events.js";
import { AgentLoopLimitError } from "../core/errors.js";
import { Msg, type Message, type ToolUseContentBlock } from "../core/types.js";
import type { Provider } from "../providers/provider.js";
import { AgentSession } from "./session.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { ToolRegistry } from "./tool-registry.js";

export interface AgentLoopOptions {
  provider: Provider;
  model?: string;
  tools: ToolRegistry;
  session: AgentSession;
  events?: AgentEventBus;
  maxToolCallRounds?: number;
  temperature?: number;
  maxTokens?: number;
}

export interface AgentTurnResult {
  responseText: string;
  toolCallRounds: number;
  hitRoundLimit: boolean;
}

const DEFAULT_MAX_ROUNDS = 12;

export async function runAgentTurn(userMessage: string, options: AgentLoopOptions): Promise<AgentTurnResult> {
  const { provider, tools, session, events } = options;
  const maxRounds = options.maxToolCallRounds ?? DEFAULT_MAX_ROUNDS;

  session.addMessage(Msg.user(userMessage));

  // System prompt: only build and send on the first turn.
  // After that, the provider's conversation history already includes it.
  const systemPrompt = session.isFirstTurn()
    ? buildSystemPrompt(tools.list(), session.getContext())
    : undefined;

  session.markFirstTurnDone();

  let rounds = 0;
  let finalText = "";

  while (true) {
    let streamedText = false;
    let response;

    try {
      events?.emit({ type: "model_start", providerName: provider.name });
      response = await provider.chat({
        messages: [...session.getHistory()],
        tools: tools.list(),
        systemPrompt,
        model: options.model,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        onTextDelta: (text) => {
          if (!text) return;
          streamedText = true;
          events?.emit({ type: "text_delta", text });
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      events?.emit({ type: "error", message });
      finalText = `Error: ${message}`;
      session.addMessage(Msg.assistantText(finalText));
      return { responseText: finalText, toolCallRounds: rounds, hitRoundLimit: false };
    }

    session.addMessage(response.message);

    const textBlocks = response.message.content.filter((b) => b.type === "text");
    const toolUseBlocks = response.message.content.filter(
      (b): b is ToolUseContentBlock => b.type === "tool_use"
    );

    // Emit any text that wasn't already streamed
    if (!streamedText) {
      for (const block of textBlocks) {
        if (block.text) events?.emit({ type: "text_delta", text: block.text });
      }
    }

    if (toolUseBlocks.length === 0) {
      finalText = textBlocks.map((b) => b.text).join("\n");
      events?.emit({ type: "turn_end", stopReason: response.stopReason });
      break;
    }

    if (rounds >= maxRounds) {
      const limitMessage = `Stopped after ${maxRounds} tool-call rounds. Tell me how to proceed.`;
      session.addMessage(Msg.assistantText(limitMessage));
      finalText = limitMessage;
      events?.emit({ type: "turn_end", stopReason: "max_tokens" });
      throw new AgentLoopLimitError(limitMessage);
    }

    rounds++;

    // Execute all tool calls, batch results back
    const resultMessages: Message[] = [];
    for (const block of toolUseBlocks) {
      events?.emit({ type: "tool_call_start", toolName: block.name, toolUseId: block.id, input: block.input });

      const tool = tools.get(block.name);
      if (!tool) {
        const errorOutput = `No tool named "${block.name}" is registered.`;
        events?.emit({ type: "tool_call_end", toolName: block.name, toolUseId: block.id, output: errorOutput, isError: true });
        resultMessages.push(Msg.toolResult(block.id, errorOutput, true));
        continue;
      }

      try {
        const result = await tool.execute(block.input);
        events?.emit({ type: "tool_call_end", toolName: block.name, toolUseId: block.id, output: result.output, isError: result.isError });
        resultMessages.push(Msg.toolResult(block.id, result.output, result.isError));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        events?.emit({ type: "tool_call_end", toolName: block.name, toolUseId: block.id, output: message, isError: true });
        resultMessages.push(Msg.toolResult(block.id, `Tool threw: ${message}`, true));
      }
    }

    for (const msg of resultMessages) session.addMessage(msg);
  }

  return { responseText: finalText, toolCallRounds: rounds, hitRoundLimit: false };
}
// Core conversational agent loop.
// - The system prompt is rebuilt and sent on every turn. The Anthropic,
//   OpenAI-compatible, and Gemini APIs used here are all stateless per
//   request — none of them remember a system prompt from a previous call.
//   Omitting it after turn 1 silently drops all operating rules and
//   tool-use guidance for the rest of the conversation. It's a small
//   string (a few hundred tokens), so resending it is cheap insurance.
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
  /** Cap on conversation history sent per request, to bound token usage on long sessions. */
  maxHistoryMessages?: number;
}

export interface AgentTurnResult {
  responseText: string;
  toolCallRounds: number;
  hitRoundLimit: boolean;
}

const DEFAULT_MAX_ROUNDS = 12;
const DEFAULT_MAX_HISTORY_MESSAGES = 60;

export async function runAgentTurn(userMessage: string, options: AgentLoopOptions): Promise<AgentTurnResult> {
  const { provider, tools, session, events } = options;
  const maxRounds = options.maxToolCallRounds ?? DEFAULT_MAX_ROUNDS;
  const maxHistory = options.maxHistoryMessages ?? DEFAULT_MAX_HISTORY_MESSAGES;

  session.addMessage(Msg.user(userMessage));

  // Built fresh every turn — see note above on why this can't be sent once.
  const systemPrompt = buildSystemPrompt(tools.list(), session.getContext());

  let rounds = 0;
  let finalText = "";

  while (true) {
    let streamedText = false;
    let response;

    // Bound how much history we resend each call. Keeps token usage (and
    // cost/latency) from growing unboundedly over a long session — older
    // turns are dropped from the wire payload, not from the saved session
    // file, so /resume still has the full history.
    session.truncateHistory(maxHistory);

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

    const textBlocks = response.message.content.filter((b) => b.type === "text");
    const toolUseBlocks = response.message.content.filter(
      (b): b is ToolUseContentBlock => b.type === "tool_use"
    );

    // Some models — especially small ones not reliably fine-tuned for tool
    // calling — return an empty or whitespace-only response when handed a
    // full tool schema. If that happens, don't silently store an empty
    // message: several provider APIs reject empty content arrays on the
    // *next* request, which would corrupt the rest of the session. Replace
    // it with a visible placeholder so (a) you actually see something
    // happened and (b) the session stays valid.
    const hasRealContent =
      toolUseBlocks.length > 0 || textBlocks.some((b) => b.text.trim().length > 0);

    if (!hasRealContent) {
      const reason = response.stopReason ? ` (stop reason: ${response.stopReason})` : "";
      const placeholder = `[No response content received from the model${reason}. Small models often don't support tool calling reliably — try a larger model, or check /provider.]`;
      response.message.content = [{ type: "text", text: placeholder }];
    }

    session.addMessage(response.message);

    // Emit any text that wasn't already streamed
    if (!streamedText) {
      for (const block of response.message.content) {
        if (block.type === "text" && block.text) events?.emit({ type: "text_delta", text: block.text });
      }
    }

    if (toolUseBlocks.length === 0) {
      finalText = response.message.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("\n");
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
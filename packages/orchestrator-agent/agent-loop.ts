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
import { Msg } from "../core/types.js";
import type { Provider } from "../providers/provider.js";
import { AgentSession } from "./session.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { ToolRegistry } from "./tool-registry.js";
import {
  collectAssistantText,
  emitBufferedAssistantText,
  ensureVisibleAssistantContent,
  executeToolCalls,
  getAssistantContent,
  requestModelTurn,
} from "./agent-turn.js";

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
    // Bound how much history we resend each call. Keeps token usage (and
    // cost/latency) from growing unboundedly over a long session — older
    // turns are dropped from the wire payload, not from the saved session
    // file, so /resume still has the full history.
    session.truncateHistory(maxHistory);

    try {
      const turn = await requestModelTurn({
        provider,
        messages: session.getHistory(),
        tools,
        systemPrompt,
        events,
        model: options.model,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
      });

      const response = turn.response;
      const content = getAssistantContent(response);
      ensureVisibleAssistantContent(response, content);
      session.addMessage(response.message);
      emitBufferedAssistantText(response, turn.streamedText, events);

      if (content.toolUseBlocks.length === 0) {
        finalText = collectAssistantText(response);
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
      const resultMessages = await executeToolCalls(content.toolUseBlocks, tools, events);
      for (const msg of resultMessages) session.addMessage(msg);
    } catch (err) {
      if (err instanceof AgentLoopLimitError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      events?.emit({ type: "error", message });
      finalText = `Error: ${message}`;
      session.addMessage(Msg.assistantText(finalText));
      return { responseText: finalText, toolCallRounds: rounds, hitRoundLimit: false };
    }
  }

  return { responseText: finalText, toolCallRounds: rounds, hitRoundLimit: false };
}

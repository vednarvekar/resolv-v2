// ============================================================
// resolv — orchestrator-agent/agent-loop.ts
// THE core loop. This is what replaces hardcoded command dispatch entirely:
// a free-text message goes in, the model decides whether/which tools to
// call, tools execute, results go back to the model, and this repeats until
// the model produces a plain text answer with no further tool calls (or a
// safety cap is hit).
//
// This file knows nothing about NIM/Anthropic/Gemini (talks to Provider
// only) and nothing about the TUI/REPL (emits AgentEvent only). Both seams
// are intentional — swapping either side never requires touching this file.
// ============================================================

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
  /** safety cap on how many tool-call round-trips a single user message can trigger */
  maxToolCallRounds?: number;
  temperature?: number;
  maxTokens?: number;
}

export interface AgentTurnResult {
  /** the final assistant-visible text response for this turn */
  responseText: string;
  /** how many tool-call round-trips happened before the model gave a plain-text answer */
  toolCallRounds: number;
  /** true if the loop stopped because maxToolCallRounds was hit, not because the model finished naturally */
  hitRoundLimit: boolean;
}

const DEFAULT_MAX_ROUNDS = 12;

/**
 * Runs one full turn of the agent loop for a single user message: sends the
 * message (plus full history) to the provider, and if the model calls
 * tools, executes them and feeds results back, repeating until the model
 * responds with plain text (or the round cap is hit).
 */
export async function runAgentTurn(userMessage: string, options: AgentLoopOptions): Promise<AgentTurnResult> {
  const { provider, tools, session, events } = options;
  const maxRounds = options.maxToolCallRounds ?? DEFAULT_MAX_ROUNDS;

  session.addMessage(Msg.user(userMessage));

  let rounds = 0;
  let hitRoundLimit = false;
  let finalText = "";

  while (true) {
    const systemPrompt = buildSystemPrompt(tools.list(), session.getContext());

    let response;
    try {
      response = await provider.chat({
        messages: [...session.getHistory()],
        tools: tools.list(),
        systemPrompt,
        model: options.model,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      events?.emit({ type: "error", message });
      // surface the failure as the turn's response rather than throwing past
      // the caller — a TUI/REPL session should stay alive after a provider error
      finalText = `I hit an error talking to the model: ${message}`;
      session.addMessage(Msg.assistantText(finalText));
      return { responseText: finalText, toolCallRounds: rounds, hitRoundLimit: false };
    }

    session.addMessage(response.message);

    const textBlocks = response.message.content.filter((b) => b.type === "text");
    const toolUseBlocks = response.message.content.filter(
      (b): b is ToolUseContentBlock => b.type === "tool_use"
    );

    for (const block of textBlocks) {
      events?.emit({ type: "text_delta", text: block.text });
    }

    if (toolUseBlocks.length === 0) {
      // model gave a plain-text answer with no further tool calls — turn is complete
      finalText = textBlocks.map((b) => b.text).join("\n");
      events?.emit({ type: "turn_end", stopReason: response.stopReason });
      break;
    }

    if (rounds >= maxRounds) {
      hitRoundLimit = true;
      const limitMessage = `Stopped after ${maxRounds} tool-call rounds in a single turn to avoid an unbounded loop. ` +
        `Tell me how you'd like to proceed.`;
      session.addMessage(Msg.assistantText(limitMessage));
      finalText = limitMessage;
      events?.emit({ type: "turn_end", stopReason: "max_tokens" });
      throw new AgentLoopLimitError(limitMessage);
    }

    rounds++;

    // execute every requested tool call, then feed all results back in one
    // batch — providers expect tool_result messages to follow their
    // corresponding tool_use message before the next assistant turn
    const resultMessages: Message[] = [];
    for (const block of toolUseBlocks) {
      events?.emit({ type: "tool_call_start", toolName: block.name, toolUseId: block.id, input: block.input });

      const tool = tools.get(block.name);
      if (!tool) {
        const errorOutput = `No tool named "${block.name}" is registered.`;
        events?.emit({ type: "tool_call_end", toolUseId: block.id, output: errorOutput, isError: true });
        resultMessages.push(Msg.toolResult(block.id, errorOutput, true));
        continue;
      }

      try {
        const result = await tool.execute(block.input);
        events?.emit({ type: "tool_call_end", toolUseId: block.id, output: result.output, isError: result.isError });
        resultMessages.push(Msg.toolResult(block.id, result.output, result.isError));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        events?.emit({ type: "tool_call_end", toolUseId: block.id, output: message, isError: true });
        resultMessages.push(Msg.toolResult(block.id, `Tool execution threw: ${message}`, true));
      }
    }

    for (const msg of resultMessages) session.addMessage(msg);
    // loop continues — next iteration sends the tool results back to the model
  }

  return { responseText: finalText, toolCallRounds: rounds, hitRoundLimit };
}
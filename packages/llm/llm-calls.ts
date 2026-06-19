import type { AgentEventBus } from "../core/events.js";
import type { AgentSession } from "../orchestrator-agent/session.js";
import type { ToolRegistry } from "../orchestrator-agent/tool-registry.js";
import type { Provider } from "../providers/provider.js";
import { runAgentTurn } from "../orchestrator-agent/agent-loop.js";

export interface LLMTurnOptions {
  provider: Provider;
  tools: ToolRegistry;
  session: AgentSession;
  events?: AgentEventBus;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  maxToolCallRounds?: number;
}

export async function runLLMChatTurn(userMessage: string, options: LLMTurnOptions) {
  return runAgentTurn(userMessage, {
    provider: options.provider,
    tools: options.tools,
    session: options.session,
    events: options.events,
    model: options.model,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    maxToolCallRounds: options.maxToolCallRounds,
  });
}

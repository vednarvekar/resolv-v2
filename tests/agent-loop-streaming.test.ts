import { describe, expect, it } from "vitest";
import { AgentEventBus } from "../packages/core/events.js";
import { AgentLoopLimitError } from "../packages/core/errors.js";
import type { AgentEvent, Message, ProviderResponse } from "../packages/core/types.js";
import { runAgentTurn } from "../packages/orchestrator-agent/agent-loop.js";
import { AgentSession } from "../packages/orchestrator-agent/session.js";
import { ToolRegistry } from "../packages/orchestrator-agent/tool-registry.js";
import type { Provider } from "../packages/providers/provider.js";

function response(text: string): ProviderResponse {
  return {
    message: { role: "assistant", content: [{ type: "text", text }] },
    stopReason: "end_turn",
  };
}

async function run(provider: Provider): Promise<AgentEvent[]> {
  const events = new AgentEventBus();
  const seen: AgentEvent[] = [];
  events.on((event) => seen.push(event));
  await runAgentTurn("hi", {
    provider,
    events,
    session: new AgentSession(),
    tools: new ToolRegistry(),
  });
  return seen;
}

describe("agent response streaming", () => {
  it("emits provider deltas without duplicating the final response", async () => {
    const events = await run({
      name: "streaming-test",
      defaultModel: "test",
      embed: async () => [],
      chat: async (options) => {
        options.onTextDelta?.("hel");
        options.onTextDelta?.("lo");
        return response("hello");
      },
    });

    expect(events.map((event) => event.type)).toEqual([
      "model_start",
      "text_delta",
      "text_delta",
      "turn_end",
    ]);
    expect(events.filter((event) => event.type === "text_delta").map((event) => event.text).join(""))
      .toBe("hello");
  });

  it("emits the final text for a provider that does not stream", async () => {
    const events = await run({
      name: "buffered-test",
      defaultModel: "test",
      embed: async () => [],
      chat: async () => response("hello"),
    });

    expect(events.find((event) => event.type === "text_delta")).toEqual({
      type: "text_delta",
      text: "hello",
    });
  });

  it("retries transient provider failures before any streamed text", async () => {
    let attempts = 0;
    const events = await run({
      name: "retry-test",
      defaultModel: "test",
      embed: async () => [],
      chat: async (options) => {
        attempts++;
        if (attempts < 3) {
          throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } });
        }
        options.onTextDelta?.("hello");
        return response("hello");
      },
    });

    expect(attempts).toBe(3);
    expect(events.map((event) => event.type)).toEqual([
      "model_start",
      "provider_retry",
      "model_start",
      "provider_retry",
      "model_start",
      "text_delta",
      "turn_end",
    ]);
  });

  it("executes tool calls and sends tool results back to the provider", async () => {
    const events = new AgentEventBus();
    const seen: AgentEvent[] = [];
    events.on((event) => seen.push(event));

    const session = new AgentSession();
    const tools = new ToolRegistry();
    tools.register({
      name: "lookup",
      description: "Look up a value",
      inputSchema: {
        type: "object",
        properties: { key: { type: "string" } },
        required: ["key"],
      },
      execute: async (input) => ({
        output: `value:${input.key}`,
        isError: false,
      }),
    });

    const providerMessages: Message[][] = [];
    const result = await runAgentTurn("use lookup", {
      provider: {
        name: "tool-test",
        defaultModel: "test",
        embed: async () => [],
        chat: async (options) => {
          providerMessages.push(options.messages);
          if (providerMessages.length === 1) {
            return {
              message: {
                role: "assistant",
                content: [{
                  type: "tool_use",
                  id: "tool-1",
                  name: "lookup",
                  input: { key: "abc" },
                }],
              },
              stopReason: "tool_use",
            };
          }
          return response("done");
        },
      },
      events,
      session,
      tools,
    });

    expect(result).toEqual({ responseText: "done", toolCallRounds: 1, hitRoundLimit: false });
    expect(providerMessages[1]).toContainEqual({
      role: "tool",
      content: [{ type: "tool_result", toolUseId: "tool-1", content: "value:abc", isError: false }],
    });
    expect(seen.filter((event) => event.type === "tool_call_start")).toEqual([{
      type: "tool_call_start",
      toolName: "lookup",
      toolUseId: "tool-1",
      input: { key: "abc" },
    }]);
    expect(seen.filter((event) => event.type === "tool_call_end")).toEqual([{
      type: "tool_call_end",
      toolName: "lookup",
      toolUseId: "tool-1",
      output: "value:abc",
      isError: false,
    }]);
  });

  it("replaces empty assistant content with a visible placeholder", async () => {
    const session = new AgentSession();
    const events = new AgentEventBus();
    const seen: AgentEvent[] = [];
    events.on((event) => seen.push(event));

    const result = await runAgentTurn("hi", {
      provider: {
        name: "empty-test",
        defaultModel: "test",
        embed: async () => [],
        chat: async () => ({
          message: { role: "assistant", content: [] },
          stopReason: "end_turn",
        }),
      },
      session,
      events,
      tools: new ToolRegistry(),
    });

    expect(result.responseText).toContain("[No response content received from the model");
    expect(session.getHistory().at(-1)?.content).toEqual([{
      type: "text",
      text: result.responseText,
    }]);
    expect(seen.find((event) => event.type === "text_delta")?.text).toContain("[No response content received from the model");
  });

  it("returns an error tool result when the model asks for an unknown tool", async () => {
    const providerMessages: Message[][] = [];

    const result = await runAgentTurn("call missing tool", {
      provider: {
        name: "missing-tool-test",
        defaultModel: "test",
        embed: async () => [],
        chat: async (options) => {
          providerMessages.push(options.messages);
          if (providerMessages.length === 1) {
            return {
              message: {
                role: "assistant",
                content: [{
                  type: "tool_use",
                  id: "missing-1",
                  name: "missing_tool",
                  input: {},
                }],
              },
              stopReason: "tool_use",
            };
          }

          return response("recovered");
        },
      },
      session: new AgentSession(),
      tools: new ToolRegistry(),
    });

    expect(result.responseText).toBe("recovered");
    expect(providerMessages[1]).toContainEqual({
      role: "tool",
      content: [{
        type: "tool_result",
        toolUseId: "missing-1",
        content: 'No tool named "missing_tool" is registered.',
        isError: true,
      }],
    });
  });

  it("captures thrown tool errors as tool results without crashing the turn", async () => {
    const providerMessages: Message[][] = [];
    const tools = new ToolRegistry();
    tools.register({
      name: "explode",
      description: "Throw an error",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        throw new Error("boom");
      },
    });

    const result = await runAgentTurn("call broken tool", {
      provider: {
        name: "tool-error-test",
        defaultModel: "test",
        embed: async () => [],
        chat: async (options) => {
          providerMessages.push(options.messages);
          if (providerMessages.length === 1) {
            return {
              message: {
                role: "assistant",
                content: [{
                  type: "tool_use",
                  id: "explode-1",
                  name: "explode",
                  input: {},
                }],
              },
              stopReason: "tool_use",
            };
          }

          return response("handled");
        },
      },
      session: new AgentSession(),
      tools,
    });

    expect(result.responseText).toBe("handled");
    expect(providerMessages[1]).toContainEqual({
      role: "tool",
      content: [{
        type: "tool_result",
        toolUseId: "explode-1",
        content: "Tool threw: boom",
        isError: true,
      }],
    });
  });

  it("throws a round-limit error before executing more tool calls than allowed", async () => {
    const tools = new ToolRegistry();
    let executions = 0;
    tools.register({
      name: "again",
      description: "Ask again",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        executions++;
        return { output: "again", isError: false };
      },
    });

    const session = new AgentSession();
    const events = new AgentEventBus();
    const seen: AgentEvent[] = [];
    events.on((event) => seen.push(event));

    await expect(runAgentTurn("loop", {
      provider: {
        name: "limit-test",
        defaultModel: "test",
        embed: async () => [],
        chat: async () => ({
          message: {
            role: "assistant",
            content: [{
              type: "tool_use",
              id: `again-${executions}`,
              name: "again",
              input: {},
            }],
          },
          stopReason: "tool_use",
        }),
      },
      events,
      session,
      tools,
      maxToolCallRounds: 1,
    })).rejects.toBeInstanceOf(AgentLoopLimitError);

    expect(executions).toBe(1);
    expect(session.getHistory().at(-1)).toEqual({
      role: "assistant",
      content: [{
        type: "text",
        text: "Stopped after 1 tool-call rounds. Tell me how to proceed.",
      }],
    });
    expect(seen.at(-1)).toEqual({ type: "turn_end", stopReason: "max_tokens" });
  });

  it("only sends the configured amount of recent history to the provider", async () => {
    const session = new AgentSession();
    session.restoreHistory([
      { role: "user", content: [{ type: "text", text: "old-1" }] },
      { role: "assistant", content: [{ type: "text", text: "old-2" }] },
      { role: "user", content: [{ type: "text", text: "old-3" }] },
    ]);

    const providerMessages: Message[][] = [];
    await runAgentTurn("fresh", {
      provider: {
        name: "history-test",
        defaultModel: "test",
        embed: async () => [],
        chat: async (options) => {
          providerMessages.push(options.messages);
          return response("ok");
        },
      },
      session,
      tools: new ToolRegistry(),
      maxHistoryMessages: 2,
    });

    const firstProviderCall = providerMessages[0];
    expect(firstProviderCall).toBeDefined();

    expect(firstProviderCall!.map((message) => {
      const block = message.content[0];
      if (!block) return "empty";
      return block.type === "text" ? block.text : block.type;
    })).toEqual(["old-3", "fresh"]);
  });
});

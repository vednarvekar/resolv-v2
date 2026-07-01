import { describe, expect, it } from "vitest";
import { AgentEventBus } from "../packages/core/events.js";
import type { AgentEvent, ProviderResponse } from "../packages/core/types.js";
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
});

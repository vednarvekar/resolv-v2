import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentEventBus } from "../packages/core/events.js";

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "").replace(/\r/g, "");
}

describe("repl transcript rendering", () => {
  const originalForceColor = process.env.FORCE_COLOR;

  afterEach(() => {
    if (originalForceColor === undefined) {
      delete process.env.FORCE_COLOR;
    } else {
      process.env.FORCE_COLOR = originalForceColor;
    }
    vi.resetModules();
  });

  it("renders assistant text without dimming and keeps padding on blank lines", async () => {
    process.env.FORCE_COLOR = "1";
    vi.resetModules();

    const { attachReplTranscript, describeToolCall, formatAssistantSegment } = await import("../apps/cli-direct/repl-transcript.js");

    const styled = formatAssistantSegment("See apps/cli-direct/repl.ts and `npm test`.");
    expect(stripAnsi(styled)).toBe("See apps/cli-direct/repl.ts and `npm test`.");
    expect(styled).not.toContain("\u001b[2m");
    expect(styled).toContain("\u001b[36m");

    expect(stripAnsi(describeToolCall("read_file", { path: "apps/cli-direct/repl.ts" }))).toBe("reading repl.ts");
    expect(stripAnsi(describeToolCall("search_web", { query: "how to build a production ready agent transcript with concise insights" }))).toBe("searching \"how to build a producti…\"");
    expect(stripAnsi(describeToolCall("fetch_github_issue", { url: "https://github.com/openai/resolv/issues/128" }))).toBe("fetching issue #128");

    const writes: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    }) as never);

    try {
      const events = new AgentEventBus();
      attachReplTranscript(events);

      events.emit({ type: "model_start", providerName: "test-provider" });
      events.emit({ type: "provider_retry", attempt: 1, maxAttempts: 3, message: "fetch failed" });
      events.emit({ type: "tool_call_start", toolName: "read_file", toolUseId: "1", input: { path: "apps/cli-direct/repl.ts" } });
      events.emit({ type: "tool_call_end", toolName: "read_file", toolUseId: "1", output: "ok", isError: false });
      events.emit({ type: "text_delta", text: "hello\n\nworld" });
      events.emit({ type: "turn_end", stopReason: "end_turn" });
    } finally {
      writeSpy.mockRestore();
    }

    const output = stripAnsi(writes.join(""));
    expect(output).toContain("retry 1/3: fetch failed");
    expect(output).toContain("reading repl.ts");
    expect(output).toContain("  hello\n  \n  world");
    expect(output).not.toContain("  hello\n\nworld");
  });
});

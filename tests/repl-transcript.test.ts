import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentEventBus } from "../packages/core/events.js";

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "").replace(/\r/g, "");
}

describe("repl transcript rendering", () => {
  const originalForceColor = process.env.FORCE_COLOR;
  const originalColumns = Object.getOwnPropertyDescriptor(process.stdout, "columns");

  afterEach(() => {
    if (originalForceColor === undefined) {
      delete process.env.FORCE_COLOR;
    } else {
      process.env.FORCE_COLOR = originalForceColor;
    }
    if (originalColumns) {
      Object.defineProperty(process.stdout, "columns", originalColumns);
    } else {
      delete (process.stdout as { columns?: number }).columns;
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
    expect(output).toContain("  ✓ read_file\n\n");
    expect(output).toContain("  hello\n  \n  world");
    expect(output).not.toContain("  hello\n\nworld");
  });

  it("keeps assistant indentation on terminal-wrapped lines", async () => {
    Object.defineProperty(process.stdout, "columns", { configurable: true, value: 26 });

    const { attachReplTranscript } = await import("../apps/cli-direct/repl-transcript.js");

    const writes: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    }) as never);

    try {
      const events = new AgentEventBus();
      attachReplTranscript(events);

      events.emit({ type: "model_start", providerName: "test-provider" });
      events.emit({ type: "text_delta", text: "alpha beta gamma delta epsilon zeta" });
      events.emit({ type: "turn_end", stopReason: "end_turn" });
    } finally {
      writeSpy.mockRestore();
    }

    const output = stripAnsi(writes.join(""));
    expect(output).toContain("  alpha beta gamma delta\n  epsilon zeta");
    expect(output).not.toContain("  alpha beta gamma delta\nepsilon zeta");
  });

  it("adds spacing after successful tools and indents error output lines", async () => {
    const { attachReplTranscript } = await import("../apps/cli-direct/repl-transcript.js");

    const writes: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    }) as never);

    try {
      const events = new AgentEventBus();
      attachReplTranscript(events);

      events.emit({ type: "tool_call_start", toolName: "scan_repo_dna", toolUseId: "1", input: {} });
      events.emit({ type: "tool_call_end", toolName: "scan_repo_dna", toolUseId: "1", output: "ok", isError: false });
      events.emit({ type: "tool_call_start", toolName: "run_tests", toolUseId: "2", input: { command: "npm test" } });
      events.emit({ type: "tool_call_end", toolName: "run_tests", toolUseId: "2", output: "line one\nline two", isError: true });
    } finally {
      writeSpy.mockRestore();
    }

    const output = stripAnsi(writes.join(""));
    expect(output).toContain("  scanning repo\n  ✓ scan_repo_dna\n\n  tests: \"npm test\"");
    expect(output).toContain("  ✗ run_tests\n  line one\n  line two\n\n");
  });

  it("keeps code block lines indented while streaming across multiple deltas", async () => {
    Object.defineProperty(process.stdout, "columns", { configurable: true, value: 28 });

    const { attachReplTranscript } = await import("../apps/cli-direct/repl-transcript.js");

    const writes: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    }) as never);

    try {
      const events = new AgentEventBus();
      attachReplTranscript(events);

      events.emit({ type: "model_start", providerName: "test-provider" });
      events.emit({ type: "text_delta", text: "```ts\nconst value = \"alpha beta gamma delta\";\n" });
      events.emit({ type: "text_delta", text: "```\nDone" });
      events.emit({ type: "turn_end", stopReason: "end_turn" });
    } finally {
      writeSpy.mockRestore();
    }

    const output = stripAnsi(writes.join(""));
    expect(output).toContain("  ```ts\n  const value = \"alpha beta\n  gamma delta\";\n  ```\n  Done");
  });
});

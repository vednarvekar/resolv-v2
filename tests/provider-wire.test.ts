import { describe, expect, it } from "vitest";

import { Msg, type Message, type ToolDefinition } from "../packages/core/types.js";
import { ProviderError } from "../packages/core/errors.js";
import { fromGeminiResponse, toGeminiContents, toGeminiTools } from "../packages/providers/google/gemini-wire.js";
import { fromOAIResponse, toOAIMessages, toOAITools } from "../packages/providers/openai-compat/oai-wire.js";
import { fromOllamaResponse, stripReasoning, toOllamaMessage, toOllamaTools } from "../packages/providers/ollama/ollama-wire.js";

const lookupTool: ToolDefinition = {
  name: "lookup",
  description: "Look up a value",
  inputSchema: {
    type: "object",
    properties: {
      key: { type: "string", description: "Lookup key" },
      exact: { type: "boolean" },
    },
    required: ["key"],
  },
  execute: async () => ({ output: "unused", isError: false }),
};

const history: Message[] = [
  Msg.system("system from history should not be forwarded"),
  Msg.user("hello"),
  {
    role: "assistant",
    content: [{
      type: "tool_use",
      id: "call-1",
      name: "lookup",
      input: { key: "abc", exact: true },
    }],
  },
  Msg.toolResult("call-1", "found", false),
];

describe("provider wire conversion", () => {
  it("maps internal messages and tools to OpenAI-compatible payloads", () => {
    expect(toOAIMessages(history, "fresh system")).toEqual([
      { role: "system", content: "fresh system" },
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call-1",
          type: "function",
          function: { name: "lookup", arguments: JSON.stringify({ key: "abc", exact: true }) },
        }],
      },
      { role: "tool", content: "found", tool_call_id: "call-1" },
    ]);

    expect(toOAITools([lookupTool])).toEqual([{
      type: "function",
      function: {
        name: "lookup",
        description: "Look up a value",
        parameters: lookupTool.inputSchema,
      },
    }]);
  });

  it("parses OpenAI-compatible text, tool calls, usage, and finish reasons", () => {
    const response = fromOAIResponse({
      choices: [{
        message: {
          role: "assistant",
          content: "checking",
          tool_calls: [{
            id: "call-2",
            type: "function",
            function: { name: "lookup", arguments: "{\"key\":\"xyz\"}" },
          }],
        },
        finish_reason: "tool_calls",
      }],
      usage: { prompt_tokens: 7, completion_tokens: 3 },
    }, "openai");

    expect(response).toEqual({
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "checking" },
          { type: "tool_use", id: "call-2", name: "lookup", input: { key: "xyz" } },
        ],
      },
      stopReason: "tool_use",
      usage: { inputTokens: 7, outputTokens: 3 },
    });
  });

  it("keeps OpenAI-compatible malformed tool arguments recoverable", () => {
    const response = fromOAIResponse({
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "bad-json",
            type: "function",
            function: { name: "lookup", arguments: "{" },
          }],
        },
        finish_reason: "tool_calls",
      }],
    }, "openai");

    expect(response.message.content).toEqual([{
      type: "tool_use",
      id: "bad-json",
      name: "lookup",
      input: {},
    }]);
  });

  it("maps internal messages and tools to Ollama OpenAI-compatible payloads", () => {
    expect(toOllamaMessage(history, "fresh system")).toEqual([
      { role: "system", content: "fresh system" },
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call-1",
          type: "function",
          function: { name: "lookup", arguments: JSON.stringify({ key: "abc", exact: true }) },
        }],
      },
      { role: "tool", content: "found", tool_call_id: "call-1" },
    ]);

    expect(toOllamaTools([lookupTool])).toEqual(toOAITools([lookupTool]));
  });

  it("strips Ollama reasoning and parses object or string tool arguments", () => {
    expect(stripReasoning("<think>hidden</think>\nvisible")).toBe("visible");
    expect(stripReasoning("<think>unfinished")).toBe("");

    const response = fromOllamaResponse({
      choices: [{
        message: {
          role: "assistant",
          content: "<think>hidden</think>\nvisible",
          tool_calls: [
            { id: "one", type: "function", function: { name: "lookup", arguments: "{\"key\":\"one\"}" } },
            { type: "function", function: { name: "lookup", arguments: { key: "two" } } },
          ],
        },
        finish_reason: "tool_calls",
      }],
      usage: { prompt_tokens: 5, completion_tokens: 4 },
    });

    expect(response).toEqual({
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "visible" },
          { type: "tool_use", id: "one", name: "lookup", input: { key: "one" } },
          { type: "tool_use", id: "ollama-tool-1", name: "lookup", input: { key: "two" } },
        ],
      },
      stopReason: "tool_use",
      usage: { inputTokens: 5, outputTokens: 4 },
    });
  });

  it("maps internal messages and tools to Gemini payloads", () => {
    expect(toGeminiContents(history)).toEqual([
      { role: "user", parts: [{ text: "hello" }] },
      { role: "model", parts: [{ functionCall: { name: "lookup", args: { key: "abc", exact: true } } }] },
      { role: "user", parts: [{ functionResponse: { name: "call-1", response: { result: "found", isError: false } } }] },
    ]);

    expect(toGeminiTools([lookupTool])).toMatchObject([{
      name: "lookup",
      description: "Look up a value",
      parameters: {
        properties: {
          key: { description: "Lookup key" },
          exact: {},
        },
        required: ["key"],
      },
    }]);
  });

  it("parses Gemini text, function calls, usage, and missing-candidate errors", () => {
    const response = fromGeminiResponse({
      candidates: [{
        content: {
          parts: [
            { text: "checking" },
            { functionCall: { name: "lookup", args: { key: "gemini" } } },
          ],
        },
        finishReason: "STOP",
      }],
      usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 6 },
    });

    expect(response).toEqual({
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "checking" },
          { type: "tool_use", id: "lookup_0", name: "lookup", input: { key: "gemini" } },
        ],
      },
      stopReason: "tool_use",
      usage: { inputTokens: 11, outputTokens: 6 },
    });

    expect(() => fromGeminiResponse({ candidates: [] })).toThrow(ProviderError);
  });
});

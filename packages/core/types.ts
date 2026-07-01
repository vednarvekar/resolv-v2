// ============================================================
// resolv — core/types.ts
// Provider-agnostic types that every package builds on.
// Nothing in here knows about NIM, Anthropic, Gemini, or the TUI.
// ============================================================

/** A single message in a conversation. Mirrors the shape every major LLM API converges on. */
export type Role = "system" | "user" | "assistant" | "tool";

export interface TextContentBlock {
  type: "text";
  text: string;
}

export interface ToolUseContentBlock {
  type: "tool_use";
  /** unique id for this specific call, used to match it to its result */
  id: string;
  /** tool name, must match a ToolDefinition.name */
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultContentBlock {
  type: "tool_result";
  /** must match the ToolUseContentBlock.id this is responding to */
  toolUseId: string;
  content: string;
  isError: boolean;
}

export type ContentBlock = TextContentBlock | ToolUseContentBlock | ToolResultContentBlock;

export interface Message {
  role: Role;
  content: ContentBlock[];
}

/** Convenience constructors so call sites don't hand-build ContentBlock arrays everywhere. */
export const Msg = {
  user(text: string): Message {
    return { role: "user", content: [{ type: "text", text }] };
  },
  assistantText(text: string): Message {
    return { role: "assistant", content: [{ type: "text", text }] };
  },
  system(text: string): Message {
    return { role: "system", content: [{ type: "text", text }] };
  },
  toolResult(toolUseId: string, content: string, isError = false): Message {
    return { role: "tool", content: [{ type: "tool_result", toolUseId, content, isError }] };
  },
};

// ── tools ────────────────────────────────────────────────────

/** JSON Schema, simplified to the subset every provider's tool-calling API actually accepts. */
export interface JSONSchema {
  type: "object";
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
}

export interface JSONSchemaProperty {
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  enum?: string[];
  items?: JSONSchemaProperty;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  /** Actually runs the tool. Receives validated input, returns a string the model will read. */
  execute: (input: Record<string, unknown>) => Promise<ToolExecutionResult>;
}

export interface ToolExecutionResult {
  /** what gets fed back to the model as the tool_result content */
  output: string;
  isError: boolean;
}

// ── provider responses ──────────────────────────────────────

export interface ProviderResponse {
  /** the assistant message produced this turn — may contain text and/or tool_use blocks */
  message: Message;
  /** why the model stopped generating */
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "error";
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface ProviderChatOptions {
  messages: Message[];
  tools?: ToolDefinition[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  /** Receives assistant-visible text as it arrives from the provider. */
  onTextDelta?: (text: string) => void;
}

// ── agent loop events ───────────────────────────────────────
// Emitted during a run so a TUI (or anything else) can render live progress
// without the agent loop knowing anything about how it's displayed.

export type AgentEvent =
  | { type: "model_start"; providerName: string }
  | { type: "provider_retry"; attempt: number; maxAttempts: number; message: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_call_start"; toolName: string; toolUseId: string; input: Record<string, unknown> }
  | { type: "tool_call_end"; toolName: string; toolUseId: string; output: string; isError: boolean }
  | { type: "turn_end"; stopReason: ProviderResponse["stopReason"] }
  | { type: "error"; message: string };

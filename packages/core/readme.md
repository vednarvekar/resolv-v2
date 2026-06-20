# packages/core

Shared types, error classes, and the event bus. Everything else in the codebase depends on this package — it depends on nothing else.

## Files

| File | Contents |
|------|---------|
| `types.ts` | `Message`, `ContentBlock`, `ToolDefinition`, `ProviderResponse`, `AgentEvent` |
| `errors.ts` | `ProviderError`, `ToolInputError`, `AgentLoopLimitError`, `UnknownProviderError` |
| `events.ts` | `AgentEventBus` — typed event emitter for streaming TUI updates |

## Key design decisions

**Why not use `node:events`?** The `AgentEventBus` is typed against the `AgentEvent` discriminated union instead of stringly-typed event names. This means TypeScript catches a mistyped event name at compile time.

**`Msg` helpers** in `types.ts` provide clean constructors so callers don't hand-build `ContentBlock[]` everywhere: `Msg.user("text")`, `Msg.assistantText("text")`, `Msg.toolResult(id, content)`.

**`AgentEvent`** is what the agent loop emits. The REPL listens to `text_delta` events to stream text to the terminal in real time, and `tool_call_start`/`tool_call_end` to show tool progress.
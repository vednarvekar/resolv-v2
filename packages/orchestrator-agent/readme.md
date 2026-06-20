# packages/orchestrator-agent

The conversational agent loop. Takes a user message, manages tool-call round-trips, and returns a final text response.

## Files

| File | Responsibility |
|------|---------------|
| `agent-loop.ts` | Core loop: send message → execute tools → repeat until plain text |
| `session.ts` | Conversation history + mutable context (repo path, branch, style summary) |
| `system-prompt.ts` | Builds the system prompt from available tools + session context |
| `tool-registry.ts` | Map of registered tools, looked up by name when the model calls one |

## How the loop works

```
user message
    ↓
provider.chat(history + tools)
    ↓
model returns text? → done
model returns tool_use? → execute tools → add results to history → repeat
    ↓
maxToolCallRounds hit? → emit warning, stop
```

The loop knows nothing about NIM/Anthropic/Gemini (talks to `Provider` interface only) and nothing about the TUI (emits `AgentEvent` only). Both seams are intentional.

## Tool registration

Tools are registered in `repl.ts` via `createLLMTools(repoRoot)` and added to a `ToolRegistry` instance. The registry is passed to `runAgentTurn` which uses it to look up and execute tool calls.

## Session context

`AgentSession` holds:
- Full conversation `history: Message[]` — sent to the provider on every turn
- `repoPath` — current working directory
- `currentBranch` — set after git operations
- `styleSummary` — short DNA summary from a prior scan

`truncateHistory(n)` can be called to keep prompt size manageable for long sessions.
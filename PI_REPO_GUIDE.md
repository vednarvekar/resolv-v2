# Pi Repo Guide

This guide maps the `pi/` repo only. Use it when you want to quickly answer: "where is the code for this behavior?"

## Big Picture

`pi` is a TypeScript monorepo. The most important packages are:

- `pi/packages/coding-agent`: the CLI app and coding-agent harness. This is where terminal modes, sessions, tools like read/edit/grep/find, skills, prompts, settings, and UI live.
- `pi/packages/agent`: the lower-level generic agent loop. This owns message state, model turns, tool-call execution, steering/follow-up queues, and event emission.
- `pi/packages/ai`: model/provider integration. This is where OpenAI/Anthropic/Google/etc provider adapters, model registries, streaming, auth helpers, and message conversion utilities live.
- `pi/packages/tui`: terminal UI primitives used by the interactive mode.

If you are studying how the CLI coding agent works, start in `packages/coding-agent`. If you are studying how an LLM response becomes tool calls and more LLM turns, jump to `packages/agent`.

## Most Useful Entry Points

- `pi/packages/coding-agent/src/main.ts`: main CLI entry. Parses args, picks interactive/print/RPC mode, resolves sessions/models/settings, then creates the runtime.
- `pi/packages/coding-agent/src/cli.ts`: CLI executable wrapper.
- `pi/packages/coding-agent/src/core/sdk.ts`: programmatic API for creating an `AgentSession`. Registers the underlying `Agent`, model streaming function, default tools, settings, resource loader, and session manager.
- `pi/packages/coding-agent/src/core/agent-session.ts`: central coding-agent session object. Handles prompts, slash commands, prompt templates, skills, active tools, system prompt rebuilds, events, compaction, retries, and persistence wiring.
- `pi/packages/agent/src/agent.ts`: generic stateful `Agent`. Owns transcript state, current tools, streaming status, queues, and calls the agent loop.
- `pi/packages/agent/src/agent-loop.ts`: core loop that sends context to the model, streams assistant responses, executes tool calls, appends tool results, and continues until done.

## "Where Is File Finding From User Input?"

There are a few different meanings:

- User passes files on the CLI with `@file`: `pi/packages/coding-agent/src/cli/file-processor.ts`.
- Initial prompt combines stdin, `@file` content, and CLI text: `pi/packages/coding-agent/src/cli/initial-message.ts`.
- Agent finds files by glob during a session: `pi/packages/coding-agent/src/core/tools/find.ts`.
- Agent searches inside files: `pi/packages/coding-agent/src/core/tools/grep.ts`.
- Agent lists directories: `pi/packages/coding-agent/src/core/tools/ls.ts`.
- Agent reads file contents: `pi/packages/coding-agent/src/core/tools/read.ts`.
- Tool registration and default tool sets: `pi/packages/coding-agent/src/core/tools/index.ts`.

The `find` tool uses `fd` by default and respects `.gitignore`. The `grep` tool uses `rg` by default. Both expose `ToolDefinition`s that the model can call.

## "Where Does It Decide What Changes Need To Be Done?"

There is no separate hard-coded planner for coding changes in this repo. The "plan" is mostly model behavior produced from:

- System prompt construction: `pi/packages/coding-agent/src/core/system-prompt.ts`.
- Project context files like `AGENTS.md` and `CLAUDE.md`: loaded by `pi/packages/coding-agent/src/core/resource-loader.ts`.
- Skills: `pi/packages/coding-agent/src/core/skills.ts`.
- Prompt templates: `pi/packages/coding-agent/src/core/prompt-templates.ts`.
- Available tool descriptions/snippets: each tool file under `pi/packages/coding-agent/src/core/tools/`.
- The generic LLM/tool loop: `pi/packages/agent/src/agent-loop.ts`.

So if you are looking for "planning logic," inspect prompts/resources first, then the agent loop. If a `/plan` behavior exists, it is likely an extension or prompt template, not a core planner; search with:

```bash
rg -n "plan|planning|todo|checklist" pi
```

## Prompt And Turn Flow

Typical path for an interactive prompt:

1. `src/main.ts` chooses the mode and creates runtime/services.
2. `src/modes/interactive/interactive-mode.ts` receives user input.
3. `src/core/agent-session.ts` `prompt()` handles slash commands, extension input hooks, skills, prompt templates, queueing, validation, and then calls the underlying agent.
4. `packages/agent/src/agent.ts` `prompt()` starts the generic run.
5. `packages/agent/src/agent-loop.ts` builds LLM context, streams the assistant message, executes tool calls, appends tool results, and continues.
6. `src/core/session-manager.ts` records messages, model changes, tool events, compaction entries, and branch structure.

## Tools

Built-in coding tools live in `pi/packages/coding-agent/src/core/tools/`:

- `read.ts`: read a file.
- `bash.ts`: execute shell commands.
- `edit.ts`: apply structured edits.
- `write.ts`: write files.
- `grep.ts`: search file contents with ripgrep.
- `find.ts`: find files by glob with fd.
- `ls.ts`: list directories.
- `edit-diff.ts`: edit validation and diff generation helpers.
- `file-mutation-queue.ts`: serializes file mutations to avoid edit/write races.
- `path-utils.ts`: resolves tool paths against cwd safely.
- `truncate.ts`: truncates large tool output.
- `render-utils.ts`: terminal rendering helpers for tool output.
- `tool-definition-wrapper.ts`: wraps plain agent tools into richer coding-agent tool definitions.

`src/core/tools/index.ts` is the registry/factory file. It defines tool names, creates tool definitions, and groups default tool sets.

## Sessions And Persistence

- `pi/packages/coding-agent/src/core/session-manager.ts`: JSONL session files, session tree entries, message entries, model/thinking-level changes, compaction entries, labels, session listing, resume/fork support.
- `pi/packages/coding-agent/src/core/agent-session-runtime.ts`: owns the current `AgentSession` plus cwd-bound services. Handles switching, resuming, new sessions, importing, and teardown/rebind.
- `pi/packages/coding-agent/src/core/session-cwd.ts`: handles missing or changed session working directories.
- `pi/packages/coding-agent/src/cli/session-picker.ts`: UI/CLI session selection helpers.

## Resources: Skills, Prompts, Context Files, Extensions

- `pi/packages/coding-agent/src/core/resource-loader.ts`: loads extensions, skills, prompt templates, themes, system prompt overrides, appended system prompts, and context files.
- `pi/packages/coding-agent/src/core/skills.ts`: skill discovery/loading/formatting.
- `pi/packages/coding-agent/src/core/prompt-templates.ts`: prompt template discovery and expansion.
- `pi/packages/coding-agent/src/core/extensions/`: extension loader, runner, wrapper, and type definitions.
- `pi/packages/coding-agent/src/core/package-manager.ts`: resolves configured resource packages/paths.

Project context files are loaded from `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, or `CLAUDE.MD` in the agent dir and cwd ancestors.

## Modes And UI

- `pi/packages/coding-agent/src/modes/interactive/interactive-mode.ts`: full-screen terminal chat mode.
- `pi/packages/coding-agent/src/modes/print-mode.ts`: single-shot print/json mode.
- `pi/packages/coding-agent/src/modes/rpc/rpc-mode.ts`: JSONL/RPC server mode.
- `pi/packages/coding-agent/src/modes/rpc/rpc-client.ts`: client helper for driving RPC mode.
- `pi/packages/coding-agent/src/modes/interactive/components/`: terminal UI components for messages, selectors, tool execution views, footer, diffs, etc.
- `pi/packages/coding-agent/src/modes/interactive/theme/`: built-in themes and theme loading.

## Models, Providers, Auth

- `pi/packages/coding-agent/src/core/model-registry.ts`: available model registry and auth checks.
- `pi/packages/coding-agent/src/core/model-resolver.ts`: chooses initial model/default model/scoped models.
- `pi/packages/coding-agent/src/core/auth-storage.ts`: credential storage.
- `pi/packages/coding-agent/src/core/auth-guidance.ts`: user-facing missing-auth/missing-model messages.
- `pi/packages/ai/src/providers/`: provider-specific API integrations.
- `pi/packages/ai/src/models.ts` and `models.generated.ts`: model metadata.
- `pi/packages/ai/src/stream.ts`: streaming abstractions.

## Compaction And Context Management

- `pi/packages/coding-agent/src/core/compaction/`: coding-agent context compaction and branch summarization.
- `pi/packages/agent/src/harness/compaction/`: lower-level harness compaction utilities.
- `pi/packages/coding-agent/docs/compaction.md`: docs for compaction behavior.
- `pi/packages/coding-agent/docs/session-format.md`: session file format docs.

## Settings, Config, Trust

- `pi/packages/coding-agent/src/cli/args.ts`: CLI flags and help text.
- `pi/packages/coding-agent/src/core/settings-manager.ts`: settings loading/merging.
- `pi/packages/coding-agent/src/core/project-trust.ts`: project trust state used by the app.
- `pi/packages/coding-agent/src/core/trust-manager.ts`: trust store and trust-requiring resources.
- `pi/packages/coding-agent/src/config.ts`: paths, package locations, version/config constants.

## Good Search Commands

Find a file by name:

```bash
rg --files pi | rg 'agent-session|resource-loader|find.ts'
```

Find where a function/class is defined:

```bash
rg -n "class AgentSession|function createAgentSession|async prompt" pi/packages
```

Find tool behavior:

```bash
rg -n "create.*ToolDefinition|promptSnippet|parameters:|execute\\(" pi/packages/coding-agent/src/core/tools
```

Find prompt/system behavior:

```bash
rg -n "systemPrompt|buildSystemPrompt|prompt template|skill|AGENTS.md|CLAUDE.md" pi/packages/coding-agent/src
```

Find session persistence behavior:

```bash
rg -n "append.*Message|buildSessionContext|SessionManager|sessionFile|jsonl" pi/packages/coding-agent/src pi/packages/agent/src
```

Find where model requests happen:

```bash
rg -n "streamSimple|streamFn|provider|apiKey|onPayload|onResponse" pi/packages
```

## Quick Debugging Paths

- "The CLI flag is not doing what I expect": start with `src/cli/args.ts`, then `src/main.ts`.
- "The initial message is wrong": `src/cli/file-processor.ts`, `src/cli/initial-message.ts`, then mode-specific prompt call.
- "The agent cannot find/read/edit files": `src/core/tools/find.ts`, `grep.ts`, `read.ts`, `edit.ts`, `write.ts`, and `path-utils.ts`.
- "The agent did not get my project instructions": `src/core/resource-loader.ts` and `src/core/system-prompt.ts`.
- "A slash command behaves strangely": `src/core/slash-commands.ts`, `src/core/agent-session.ts`, and `src/core/extensions/`.
- "Session resume/fork/import is strange": `src/core/session-manager.ts` and `src/core/agent-session-runtime.ts`.
- "Tool calls are not executed as expected": `packages/agent/src/agent-loop.ts`, especially stream response and tool execution sections.
- "Provider/model behavior is strange": `packages/ai/src/providers/`, `packages/ai/src/models.ts`, and `packages/coding-agent/src/core/model-registry.ts`.

## Reading Order For Your Example

If your concrete question is: "how does the agent find files from user input and then decide edits?" read in this order:

1. `pi/packages/coding-agent/src/core/tools/find.ts`
2. `pi/packages/coding-agent/src/core/tools/grep.ts`
3. `pi/packages/coding-agent/src/core/tools/read.ts`
4. `pi/packages/coding-agent/src/core/tools/edit.ts`
5. `pi/packages/coding-agent/src/core/tools/index.ts`
6. `pi/packages/coding-agent/src/core/agent-session.ts`
7. `pi/packages/coding-agent/src/core/system-prompt.ts`
8. `pi/packages/agent/src/agent-loop.ts`

That path shows the concrete file-search/edit tools, how they are exposed to the model, how prompts are prepared, and how the model's tool calls are executed.

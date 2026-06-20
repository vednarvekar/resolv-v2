# apps/cli-direct

Command handlers for the resolv CLI. Each file owns one command or closely related commands.

## Files

| File | Command(s) |
|------|-----------|
| `repl.ts` | The interactive shell — routes input to handlers or LLM |
| `config-command.ts` | `/config` — prints current provider/model/key status |
| `dna-command.ts` | `/dna`, `resolv dna` — runs DNA scan |
| `solve-command.ts` | `resolv solve <url>` — full issue-fix pipeline |
| `provider-command.ts` | `/provider`, `/model` — interactive provider/model switching |

## Separation of concerns

- **Visual output** (banners, colors, arrow menus) → `apps/tui/`
- **Command execution** (what to do) → `apps/cli-direct/`
- **Business logic** (DNA extraction, LLM calls, git ops) → `packages/`

## REPL routing

The REPL in `repl.ts` handles:
- `/slash-commands` → dispatched to handlers here
- *free text* → passed to `runLLMChatTurn` in `packages/llm/llm-calls.ts`

Tab completion is powered by `apps/tui/slash-commands/registry.ts` via readline's `completer` option.
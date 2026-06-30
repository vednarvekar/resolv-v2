# apps/tui

Terminal UI components. Handles everything visual that isn't a command handler.

## Files

| File | Responsibility |
|------|---------------|
| `setup-wizard.ts` | First-run interactive setup (provider → API key → model) |
| `slash-commands/registry.ts` | Central list of all `/commands` + tab completer |

## Setup wizard

Runs automatically on first launch (no config file at `~/.config/resolv/config.json`). Can be re-run with `resolv setup`.

Flow:
1. ASCII banner
2. Arrow-key provider selection
3. API key input when the provider needs one
4. Provider-backed model selection, or manual model entry if discovery fails
5. Optional GitHub token
6. Saves config and starts REPL

Ollama path skips the API key step and shows install instructions instead.

## Slash command registry

All `/command` definitions live in `slash-commands/registry.ts`. The REPL's readline tab completer and the `/help` output both read from this single list — no duplication.

To add a new slash command:
1. Add an entry to `SLASH_COMMANDS` in `registry.ts`
2. Add the handler case in `apps/cli-direct/repl.ts`

## Why separate from cli-direct?

`apps/tui/` owns visual presentation logic (arrow menus, banners, color choices).  
`apps/cli-direct/` owns command execution logic (what happens when you run `/dna`).  

This keeps UI concerns out of the command handlers, making it easier to swap the TUI layer later if needed.

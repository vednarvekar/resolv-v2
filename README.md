# resolv

A CLI agent that fixes GitHub issues in your local repository — matching the repo's existing code style, not writing code "its own way."

It is built around a simple idea: before asking an LLM to edit code, inspect the repo first. resolv extracts a "DNA" profile from the codebase, finds likely files, asks a planner model to narrow the target set, generates small SEARCH/REPLACE edits, runs tests, retries on failure, commits the result, and can open a PR.

## How it works

`resolv solve <github-issue-url>` does this:

1. Checks the repo has a clean working tree
2. Fetches the GitHub issue + comments
3. Scans the repo's "DNA" — dominant style patterns, named functions, shared helpers
4. Finds candidate files via keyword matching + optional semantic search
5. Uses an LLM planner to pick the most relevant files
6. Creates `fix/issue-<N>` branch
7. Asks the provider for SEARCH/REPLACE edits
8. Applies edits, runs tests, retries on failure (self-heal loop)
9. Commits the passing fix
10. Opens a PR if `GITHUB_TOKEN` is configured

## Quick start

```bash
npm install
npm run build
npm link          # optional, adds `resolv` to PATH

resolv            # first run triggers setup wizard
```

## Commands

| Command | Description |
|---------|-------------|
| `resolv` | Start interactive shell (runs setup wizard on first run) |
| `resolv setup` | Re-run setup wizard |
| `resolv solve <url>` | Fix a GitHub issue |
| `resolv dna` | Scan repo DNA without fixing anything |
| `resolv config` | Show current configuration |

## Shell commands (inside `resolv` REPL)

| Command | Description |
|---------|-------------|
| `/config` | Show provider, model, key status |
| `/dna` | Scan current repo, save to `.resolv/analysis.json` |
| `/provider` | Switch provider (interactive) |
| `/model` | Switch model (interactive) |
| `/help` | List all commands |
| `/clear` | Clear screen |
| `/exit` | Quit |
| *anything else* | Chat with the LLM agent |

## Supported providers

- **Anthropic** (Claude) — `claude-sonnet-4-6`, `claude-opus-4-6`
- **Google** (Gemini) — `gemini-2.5-pro`, `gemini-2.5-flash`
- **NVIDIA NIM** — `deepseek-r1`, `llama-3.3-70b`, and others
- **Ollama** — local models, no API key needed

## Configuration

Config is stored at `~/.config/resolv/config.json` (owner read/write only).

Run `resolv setup` to reconfigure, or use `/provider` and `/model` inside the REPL.

Optional env overrides (for CI):
```bash
ANTHROPIC_API_KEY=...
GOOGLE_API_KEY=...
NVIDIA_API_KEY=...
GITHUB_TOKEN=...
RESOLV_PROVIDER=anthropic
RESOLV_MODEL=claude-sonnet-4-6
RESOLV_TEST_COMMAND="npm test"
RESOLV_MAX_ATTEMPTS=4
OLLAMA_BASE_URL=http://localhost:11434
```

## Project structure

```
bin/              CLI entry point
apps/
  cli-direct/     Command handlers (solve, dna, config, provider, model)
  tui/            Setup wizard and slash-command registry
config/           Config manager (load/save ~/.config/resolv/config.json)
packages/
  core/           Shared types, errors, event bus
  dna/            Repo analysis (files, functions, helpers, architecture)
  providers/      LLM provider adapters (Anthropic, Google, NIM, Ollama)
  llm/            Prompt builder, agent loop wiring
  orchestrator-agent/  Conversational agent loop, session, tool registry
  context-agent/  GitHub issue fetching, keyword + semantic file mapping
  coding-agent/   SEARCH/REPLACE application, git operations, self-heal loop
  planner/        LLM planning subagent for file selection
```
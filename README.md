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

If you want the linked `resolv` command to track source edits while you work in another repo, keep `npm run watch` running in this repo. `npm run dev` runs the source directly, but only from inside this checkout.

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
| `/config` | Show provider, model, and masked key status |
| `/config change` | Interactively change API key, GitHub token, test command, or retries |
| `/config-change` | Alias for `/config change` |
| `/config key` | Replace the active provider's API key |
| `/dna` | Scan current repo, save to `.resolv/analysis.json` |
| `/provider` | Switch provider (interactive) |
| `/model` | Switch model (interactive) |
| `/help` | List all commands |
| `/clear` | Clear screen |
| `/exit` | Quit |
| *anything else* | Chat with the LLM agent |

## Supported providers

- **Anthropic** (Claude)
- **Google** (Gemini)
- **NVIDIA NIM**
- **OpenAI** (GPT)
- **xAI Grok**
- **OpenRouter**
- **Ollama** — local models, no API key needed

`/model`, `/provider`, and `resolv setup` fetch available models from the selected provider or local Ollama runtime. If discovery fails, resolv asks for a model name manually instead of relying on hardcoded model menus.

## Configuration

Config is stored at `~/.config/resolv/config.json` (owner read/write only).

Run `resolv setup` to reconfigure, or use `/provider` and `/model` inside the REPL.

Optional env overrides can be exported by the shell or placed in a `.env` file in the working directory:
```bash
ANTHROPIC_API_KEY=...
GOOGLE_API_KEY=...
OPENAI_API_KEY=...
XAI_API_KEY=...
OPENROUTER_API_KEY=...
NVIDIA_API_KEY=...
NIM_REQUEST_TIMEOUT_MS=90000
GITHUB_TOKEN=...
RESOLV_PROVIDER=openrouter
RESOLV_MODEL=qwen/qwen-2.5-72b-instruct
RESOLV_TEST_COMMAND="npm test"
RESOLV_MAX_ATTEMPTS=4
RESOLV_MAX_TOOL_CALL_ROUNDS=24
OLLAMA_BASE_URL=http://localhost:11434
```

For any provider other than `ollama`, the active provider credentials are loaded from the selected provider config or the corresponding environment variable.

### Ollama on Windows with a WSL client

Ollama listens on Windows loopback by default. With WSL's default NAT networking,
`127.0.0.1` inside WSL is not Windows loopback. Prefer WSL mirrored networking on
Windows 11 by adding this to `%UserProfile%\.wslconfig` and then running
`wsl --shutdown` from PowerShell:

```ini
[wsl2]
networkingMode=mirrored
```

After restarting WSL, verify the connection before starting resolv:

```bash
curl http://127.0.0.1:11434/api/tags
```

For remote or NAT-hosted Ollama instances, set `OLLAMA_BASE_URL` to an address
reachable from the environment where resolv runs. The CLI performs a startup
health check and reports an actionable connection or missing-model error.

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
  providers/      LLM provider adapters + model discovery
  llm/            Prompt builder, agent loop wiring
  orchestrator-agent/  Conversational agent loop, session, tool registry
  context-agent/  GitHub issue fetching, keyword + semantic file mapping
  coding-agent/   SEARCH/REPLACE application, git operations, self-heal loop
  planner/        LLM planning subagent for file selection
```

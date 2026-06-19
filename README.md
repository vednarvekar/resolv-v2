# resolv

resolv is a CLI agent for fixing GitHub issues in a local repository while matching that repository's existing code style.

It is built around a simple idea: before asking an LLM to edit code, inspect the repo first. resolv extracts a "DNA" profile from the codebase, finds likely files, asks a planner model to narrow the target set, generates small SEARCH/REPLACE edits, runs tests, retries on failure, commits the result, and can open a PR.

The current app is a direct CLI. A conversational agent loop exists in `packages/orchestrator-agent`, but it is not wired into a full chat UI or TUI yet.

## Current Status

Working now:

- `resolv config` checks provider configuration.
- `resolv dna` scans a repository and prints its style profile.
- `resolv solve <issue-url>` runs the full issue-fixing pipeline.
- Providers are swappable with `RESOLV_PROVIDER`: `nim`, `anthropic`, or `google`.
- The no-argument `resolv` shell currently supports `config`, `help`, and `exit`.

Not wired yet:

- A full chat interface.
- A terminal UI.
- Tool registration that connects the conversational orchestrator to filesystem, git, DNA, and solve actions.

## How It Works

`resolv solve <github-issue-url>` does this:

1. Checks the target repo has a clean working tree.
2. Fetches the GitHub issue and comments.
3. Extracts repo DNA: files, imports, exports, functions, helpers, call graph, architecture layers, naming style, async style, error style, and dependency usage.
4. Finds candidate files using keyword matching and, when available, semantic search with embeddings.
5. Runs a planner model call to choose the files/functions most likely to matter.
6. Creates or checks out `fix/issue-<number>`.
7. Builds a prompt from the issue, repo DNA, and target file contents.
8. Asks the provider for SEARCH/REPLACE edits.
9. Applies edits, runs the configured test command, and retries with failure output if tests fail.
10. Commits the passing fix.
11. Opens a PR when `GITHUB_TOKEN` is configured; otherwise the commit stays local.

## Install

```bash
npm install
npm run build
```

Run without linking:

```bash
node dist/bin/resolv.js config
```

Run in development:

```bash
npx tsx bin/resolv.ts config
```

Optionally link the CLI:

```bash
npm link
resolv config
```

## Configuration

The app loads environment variables with `dotenv`, so a local `.env` file works.

Provider selection:

```bash
RESOLV_PROVIDER=nim          # default
RESOLV_PROVIDER=anthropic
RESOLV_PROVIDER=google
```

Provider keys:

```bash
NVIDIA_API_KEY=...
ANTHROPIC_API_KEY=...
GOOGLE_API_KEY=...
```

Optional settings:

```bash
GITHUB_TOKEN=...             # push branch and open PR
RESOLV_MODEL=...             # omit to use provider default
RESOLV_TEST_COMMAND="npm test"
RESOLV_MAX_ATTEMPTS=4
```

Provider defaults in code:

- `nim`: `deepseek-ai/deepseek-v4-pro`
- `anthropic`: `claude-sonnet-4-6`
- `google`: `gemini-2.5-flash`

Check setup:

```bash
resolv config
```

## Commands

### `resolv config`

Prints the selected provider and required key status.

```bash
resolv config
```

### `resolv dna`

Scans a local repo without calling an LLM.

```bash
resolv dna --path .
resolv dna --path /path/to/repo --json dna.json
```

Options:

- `-p, --path <path>`: repo to scan, defaults to current directory.
- `--json <outputPath>`: write the full DNA profile as JSON.

### `resolv solve <issue-url>`

Runs the full fixing pipeline.

```bash
resolv solve https://github.com/owner/repo/issues/123 --path /path/to/local/clone
```

Options:

- `-p, --path <path>`: local repository path, defaults to current directory.
- `--no-semantic`: skip embeddings and planner-assisted semantic search.

The target repo must be clean. Commit or stash local changes before running `solve`.


## Design Notes

- The CLI talks to a small `Provider` interface instead of provider SDKs directly.
- Fixes are requested as SEARCH/REPLACE blocks so edits stay small and reviewable.
- Semantic search is in-memory; there is no vector database.
- Anthropic currently has no embeddings implementation, so semantic search falls back through the normal error path.
- The orchestrator package is the planned chat foundation, but the current user-facing app is still command-based.

## Troubleshooting

`Unknown provider`

Set `RESOLV_PROVIDER` to `nim`, `anthropic`, or `google`.

`Cannot run resolv solve until the selected provider is configured`

Run `resolv config` and set the missing provider key.

`Working directory has uncommitted changes`

The solver refuses to mix your local work with generated changes. Commit or stash first.

`The model never produced a parseable SEARCH/REPLACE response`

Try a stronger model with `RESOLV_MODEL`, or reduce the target scope with `--no-semantic`.

`No PR was opened`

Set `GITHUB_TOKEN` with write access. Without it, resolv still commits locally on `fix/issue-<number>`.

# resolv

**In-context, style-matching issue resolver CLI with a conversational agent interface.**

Most AI coding tools write code "their own way" — ignoring existing helpers, breaking naming conventions, pulling in new dependencies nobody asked for. Maintainers reject those PRs on sight.

resolv behaves like a senior engineer who already works on the codebase. Before touching a single line, it scans the repo to build a style DNA profile — naming convention, error-handling pattern, async style, most-reused internal helpers, architecture layers — and forces the model to match that profile exactly when generating a fix. The result is a PR that looks like it came from someone who's been on the team for months.

You can drive it two ways: drop into an interactive shell and talk to it like a coding assistant (`resolv` with no arguments), or fire a one-shot command from a script or CI pipeline (`resolv solve <url>`).

---

## Table of contents

1. [How it actually works](#how-it-actually-works)
2. [Architecture](#architecture)
3. [Requirements](#requirements)
4. [Installation](#installation)
5. [Configuration](#configuration)
6. [How to run it](#how-to-run-it)
7. [Interactive shell (REPL mode)](#interactive-shell-repl-mode)
8. [Commands reference](#commands-reference)
9. [Supported LLM providers](#supported-llm-providers)
10. [Project structure](#project-structure)
11. [Design notes](#design-notes)
12. [Troubleshooting](#troubleshooting)
13. [Known limitations and what's next](#known-limitations-and-whats-next)

---

## How it actually works

When you run `resolv solve <github-issue-url>`:

1. **Dirty-directory guard.** Refuses to run if the target repo has uncommitted changes, so your in-progress work is never mixed into the automated fix branch.
2. **Issue fetch.** Pulls the issue title, body, and all comments from the GitHub API. Comments matter — maintainers often clarify the real root cause there, not in the original post.
3. **DNA extraction.** Parses the entire repo once with a shared `ts-morph` AST pass. Derives: file inventory, import/export maps, every function's shape and line count, the most-reused internal helper functions, a function call graph, architecture layer detection (route/controller/service/repository), the dominant naming convention from real AST identifier nodes (not raw text), the dominant error-handling pattern, the dominant async style, and which `package.json` dependencies are actually imported anywhere.
4. **Candidate file selection.** Two parallel passes: keyword matching (issue text against file paths and function names) plus semantic search (embeds the issue text and every file/function summary via the LLM provider's embeddings API, ranks by cosine similarity — in-memory brute-force, no vector database).
5. **Planner agent.** A focused LLM call that looks at both candidate pools and judges which files actually need to change. Falls back to keyword-matched results automatically if the call fails or returns unparseable output.
6. **Safety branch.** Creates `fix/issue-<number>` so the main branch is never touched.
7. **Generate and self-heal.** Builds a prompt that includes the actual file contents plus the full style profile, sends it to the LLM, and asks for fixes as surgical SEARCH/REPLACE blocks — not whole-file dumps. Applies each edit, runs the configured test command, and if tests fail, feeds the error back to the model and retries. Each retry only includes the most recent failure (a sliding window), so the prompt size stays roughly constant rather than growing across attempts.
8. **Commit.** Stages and commits the passing changes with a message referencing the issue number.
9. **Push and open PR.** If `GITHUB_TOKEN` is set, pushes the branch and opens a PR against the default branch. If push or PR creation fails for any reason, the failure is caught and reported — the fix is never lost, it just stays on the local branch.

---

## Architecture

resolv is structured as two layers sitting on top of each other.

**The new layer (`packages/`) — built, foundation-complete:**

```
packages/
  core/
    types.ts              Provider-agnostic types: Message, ContentBlock, ToolDefinition,
                          ProviderResponse, AgentEvent. Everything else in the codebase speaks
                          this vocabulary and never imports a concrete provider directly.
    errors.ts             Shared typed error classes: ProviderError, ToolInputError,
                          AgentLoopLimitError, UnknownProviderError.
    events.ts             Tiny typed event emitter. The agent loop emits AgentEvent values;
                          the TUI (or anything else) subscribes without the loop knowing how
                          its output is displayed.

  providers/
    provider.ts           The Provider interface: chat() + embed(). The single seam that makes
                          Claude/Gemini/NIM swappable with a config change, not a code change.
    registry.ts           Reads RESOLV_PROVIDER from env, constructs the matching provider.
                          Switching providers is: export RESOLV_PROVIDER=anthropic. Done.
    nim/                  NVIDIA NIM implementation (OpenAI-compatible wire format).
    anthropic/            Claude implementation via @anthropic-ai/sdk.
    google/               Gemini implementation via @google/generative-ai.

  orchestrator-agent/
    agent-loop.ts         THE core loop. A user message goes in; the model decides which tools
                          to call; tools execute; results feed back; repeats until the model
                          gives a plain-text answer (or a round cap is hit). This replaces the
                          old hardcoded REPL dispatch entirely — "talk to me normally" works
                          because the model, not the code, decides what to do next.
    tool-registry.ts      Aggregates ToolDefinitions, looks them up by name for the loop.
    system-prompt.ts      The agent's persona and operating rules, built from the current session
                          context (repo path, branch, style summary). Separate from loop mechanics
                          so the persona can be tuned without touching agent-loop.ts.
    session.ts            Conversation history + mutable context (repo path, current branch, last
                          DNA scan summary). Both the system prompt and tools read from here.
```

**The existing layer (`src/`) — operational, being migrated into the packages architecture:**

```
src/
  cli/
    repl.ts               Interactive shell. Currently uses a hardcoded command dispatcher;
                          will be replaced by the orchestrator-agent loop in the next phase.
    solve-command.ts      One-shot pipeline orchestrator.
    dna-command.ts        Standalone DNA inspection (no LLM, no git).
    config-command.ts     Environment variable validation.

  dna/
    extract.ts            Single ts-morph Project, one parse pass, fans out to all analyzers.
    analysis/
      files.ts            Filesystem walk, language detection, line counts.
      imports.ts          ts-morph AST for JS/TS; regex for Python.
      exports.ts          Same split as imports.ts.
      functions.ts        Every function/method/arrow: params, async flag, body size.
      helpers.ts          Which internal calls are reused most, across how many files.
      callgraph.ts        Maps each function to what it calls.
      architecture.ts     Detects route/controller/service/repository layers.
      naming.ts           camelCase vs snake_case vs PascalCase from real AST identifiers.
      errors.ts           try/catch vs .catch() vs Result-type vs callback-err per file.
      patterns.ts         async/await vs promise chains vs callbacks per file.
      dependencies.ts     package.json cross-referenced against actual import usage.
      structure.ts        Folder hierarchy map.

  semantic/
    embeddings.ts         Embeddings API client + cosine similarity.
    file-index.ts         In-memory semantic index over files + functions. No vector database —
                          at single-repo scale, brute-force cosine similarity is faster to build
                          and avoids adding infrastructure dependencies.

  github/
    fetch-issue.ts        Fetches the issue AND its comments.
    parse-issue-url.ts    Parses an issue URL into owner/repo/number.

  issue/
    issue-mapper.ts       Keyword extraction from issue text + comments → candidate files.

  planner/
    planner.ts            Turns a candidate mapping into a step list.
    planner-agent.ts      LLM subagent that narrows keyword + semantic candidates to real targets.

  llm/
    nim-client.ts         Legacy direct NIM client. Superseded by packages/providers/nim.
    prompt-builder.ts     Builds the fix-generation prompt and sliding-window retry prompt.

  healing/
    apply-fix.ts          Parses SEARCH/REPLACE blocks out of the model response, applies them
                          safely. If the SEARCH text doesn't match the file verbatim, the edit
                          is rejected rather than silently corrupting the file.
    run-tests.ts          Runs the configured test command with a timeout, captures output.
    self-heal-loop.ts     The retry loop: generate → apply → test → retry on failure.

  git/
    create-branch.ts      Branch creation + dirty-working-directory guard.
    checkout.ts           Branch checkout + current-branch lookup.
    commit.ts             Stage and commit.
    push-and-pr.ts        Push + open PR. Never throws — returns a structured outcome so
                          a working fix is never lost if the push/PR step fails.

  config.ts               Env var loading with typed defaults.
```

---

## Requirements

- **Node.js 18+** (uses native `fetch`, ESM, top-level `await`)
- **npm**
- **Git**, installed and on your PATH
- An API key for at least one LLM provider (see [Supported LLM providers](#supported-llm-providers))
- A GitHub Personal Access Token with `repo` scope — optional, only needed if you want resolv to push branches and open PRs automatically

---

## Installation

```bash
git clone <repo-url>
cd resolv-v2
npm install
npm run build
```

`npm run build` compiles everything in `bin/`, `src/`, and `packages/` from TypeScript to `dist/`. A clean `tsc` run is silent — no output means success.

To make the `resolv` command available globally from any directory:

```bash
npm run build
npm link
```

Unlink later with `npm unlink -g resolv`.

---

## Configuration

Copy the example file:

```bash
cp .env.example .env
```

Fill it in. resolv reads from `process.env` — it does not auto-load `.env` files. You need to either `export` each variable in your shell, use `direnv`, or prefix your command with the variables inline.

### Full environment variable reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `NVIDIA_API_KEY` | Required for NIM | — | Auth for NVIDIA NIM chat + embeddings. Free tier at https://build.nvidia.com |
| `ANTHROPIC_API_KEY` | Required for Anthropic | — | Auth for Claude via the Anthropic API. |
| `GOOGLE_API_KEY` | Required for Gemini | — | Auth for Gemini via Google AI Studio. |
| `GITHUB_TOKEN` | No | — | GitHub PAT with `repo` scope. Needed to push the fix branch and open a PR. Without it, the fix is committed locally but never pushed. Also helps with rate limits when fetching issue data. |
| `RESOLV_PROVIDER` | No | `nim` | Which LLM backend to use: `nim`, `anthropic`, or `google`. Changing this is the entire provider swap — no code changes anywhere else. |
| `RESOLV_MODEL` | No | Provider default | Model string to pass to the selected provider. Defaults: NIM → `meta/llama-3.3-70b-instruct`, Anthropic → `claude-sonnet-4-6`, Gemini → `gemini-2.5-flash`. |
| `RESOLV_TEST_COMMAND` | No | `npm test` | Command that runs the target repo's test suite. Set this to whatever the repo you're fixing actually uses: `pytest`, `yarn test`, `go test ./...`, `cargo test`, etc. |
| `RESOLV_MAX_ATTEMPTS` | No | `4` | How many times the self-healing loop retries a fix when tests keep failing. |

Quick start with NVIDIA NIM (free tier):

```bash
export NVIDIA_API_KEY="nvapi-xxxxxxxxxxxx"
export GITHUB_TOKEN="ghp_xxxxxxxxxxxx"
```

Quick start with Claude:

```bash
export RESOLV_PROVIDER=anthropic
export ANTHROPIC_API_KEY="sk-ant-xxxxxxxxxxxx"
export GITHUB_TOKEN="ghp_xxxxxxxxxxxx"
```

Always verify your setup before running anything else:

```bash
resolv config
```

---

## How to run it

### Option A — Built binary (recommended for regular use)

```bash
npm run build
node dist/bin/resolv.js <command> [args]
```

### Option B — Dev mode via tsx (no build step, for active development)

```bash
npx tsx bin/resolv.ts <command> [args]
```

### Option C — Global `resolv` command after `npm link`

```bash
resolv <command> [args]
```

All three options run the same code. The examples below use `resolv` for brevity.

---

## Interactive shell (REPL mode)

Running `resolv` with no arguments drops you into a persistent interactive shell:

```
resolv
```

You'll see:

```
  resolv  — in-context, style-matching issue resolver

  Type a command below. Type 'help' to see what's available, 'exit' to quit.

  Example:
    solve https://github.com/zulip/zulip/issues/123 --path ./zulip

resolv ›
```

From here you type commands directly without re-invoking the binary. The shell supports command history (up/down arrows), quoted paths with spaces, and survives errors mid-pipeline — if a `solve` run fails, you're back at the prompt rather than exiting.

```
resolv › config
resolv › dna --path ./some-repo
resolv › solve https://github.com/owner/repo/issues/456 --path ./repo
resolv › solve https://github.com/owner/repo/issues/456 --path ./repo --no-semantic
resolv › clear
resolv › help
resolv › exit
```

**Note:** The current REPL uses a hardcoded command dispatcher. The next phase of development (in progress) replaces this with the `orchestrator-agent` loop, which means you'll be able to type free-text messages like "your last change broke the auth flow, can you look at it again?" and the agent will decide on its own what tools to call — reading the relevant files, re-running tests, and responding conversationally.

---

## Commands reference

### `resolv config`

Checks your environment setup. No LLM calls, no network, no git. Run this first.

```bash
resolv config
```

Prints which variables are set and missing. Exits with code `1` if `NVIDIA_API_KEY` (or the key for your configured provider) is absent, so it's usable in CI health checks.

---

### `resolv dna`

Scans a local repo's style DNA and prints a human-readable summary. No LLM calls, no GitHub, no git writes. Safe to run on any repo you have local access to.

```bash
resolv dna --path /path/to/repo
resolv dna --path .
resolv dna --path ~/code/zulip --json zulip-dna.json
```

**Options:**

| Flag | Description |
|---|---|
| `-p, --path <path>` | Repo to scan. Defaults to current directory. |
| `--json <outputPath>` | Write the full DNA profile as JSON instead of printing a summary. |

**What the summary shows:** file/function/helper/dependency counts, dominant naming convention with raw counts (camelCase/snake_case/PascalCase/SCREAMING_SNAKE), dominant error-handling style, dominant async style, top 10 most-reused internal helpers with usage counts and file coverage, architecture layers detected, and any `package.json` dependencies that are declared but never actually imported.

---

### `resolv solve <issue-url>`

The full pipeline: fetch issue + comments, extract DNA, find candidate files (keyword + semantic), run the planner agent, create a safety branch, generate a SEARCH/REPLACE fix, run tests, self-heal on failure, commit, and optionally push + open a PR.

```bash
resolv solve https://github.com/owner/repo/issues/123 --path ./local-clone
```

**Arguments:**

| Argument | Description |
|---|---|
| `<issue-url>` | Full GitHub issue URL, e.g. `https://github.com/zulip/zulip/issues/123` |

**Options:**

| Flag | Description |
|---|---|
| `-p, --path <path>` | Path to your local clone of the repo the issue belongs to. Must be a git repository with a clean working tree. Defaults to current directory. |
| `--no-semantic` | Skip semantic search + planner agent, use plain keyword matching only. Faster and cheaper — no embedding API calls. Useful when iterating quickly or when the issue keywords already point directly at the relevant files. |

**Important:** the repo must have no uncommitted changes. resolv refuses to run on a dirty working directory so your in-progress work is never committed into the automated fix branch. Run `git status`, then `git stash` or `git commit` before retrying.

Examples:

```bash
# standard full run
resolv solve https://github.com/zulip/zulip/issues/123 --path ~/code/zulip

# faster/cheaper run skipping semantic search
resolv solve https://github.com/zulip/zulip/issues/123 --path ~/code/zulip --no-semantic

# pointing at the repo explicitly instead of cd-ing
resolv solve https://github.com/owner/repo/issues/456 --path /absolute/path/to/clone
```

---

## Supported LLM providers

Three providers are implemented and tested. All are selected via `RESOLV_PROVIDER`:

### NVIDIA NIM (default)

```bash
export RESOLV_PROVIDER=nim
export NVIDIA_API_KEY="nvapi-..."
```

Free tier available at https://build.nvidia.com. Default chat model: `meta/llama-3.3-70b-instruct`. Default embedding model: `nvidia/nv-embedqa-e5-v5` (used for semantic search). The only provider with both chat and embeddings available for free. If no `RESOLV_PROVIDER` is set, this is what you get.

### Anthropic (Claude)

```bash
export RESOLV_PROVIDER=anthropic
export ANTHROPIC_API_KEY="sk-ant-..."
export RESOLV_MODEL="claude-sonnet-4-6"    # or claude-opus-4-6, claude-haiku-4-5, etc.
```

Paid API. Default model: `claude-sonnet-4-6`. Claude does not have a public embeddings endpoint, so semantic search falls back to keyword-only matching automatically when this provider is selected — no manual `--no-semantic` flag required, it degrades gracefully.

### Google (Gemini)

```bash
export RESOLV_PROVIDER=google
export GOOGLE_API_KEY="AIza..."
export RESOLV_MODEL="gemini-2.5-flash"    # or gemini-2.5-pro, etc.
```

Free tier available via Google AI Studio at https://aistudio.google.com. Default chat model: `gemini-2.5-flash`. Default embedding model: `text-embedding-004`. Supports both chat and embeddings.

### Switching providers mid-project

Switching providers is a single env var change. Nothing in the agent loop, tools, DNA analysis, git operations, or prompt builder needs to change — they all talk to the `Provider` interface, not a concrete implementation:

```bash
# was using NIM, switch to Claude for this run
RESOLV_PROVIDER=anthropic ANTHROPIC_API_KEY="sk-ant-..." resolv solve <url> --path .
```

---

## Project structure

```
resolv-v2/
│
├── bin/
│   └── resolv.ts              CLI entry point. Reads argv, picks the right command or launches
│                              the interactive shell. Thin — no business logic here.
│
├── packages/                  The new architecture layer. Provider-agnostic, framework-free.
│   │                          Nothing in here imports from src/.
│   │
│   ├── core/
│   │   ├── types.ts           Shared vocabulary: Message, ContentBlock, ToolDefinition,
│   │   │                      ProviderResponse, AgentEvent. Every other package speaks this.
│   │   ├── errors.ts          Typed error classes: ProviderError, AgentLoopLimitError, etc.
│   │   └── events.ts          Typed event emitter. Agent loop emits; TUI subscribes.
│   │
│   ├── providers/
│   │   ├── provider.ts        The Provider interface: chat() + embed(). The swap seam.
│   │   ├── registry.ts        Reads RESOLV_PROVIDER, builds the right Provider. One env var
│   │   │                      is the entire provider switch.
│   │   ├── nim/               NVIDIA NIM (OpenAI-compatible format).
│   │   ├── anthropic/         Claude via @anthropic-ai/sdk.
│   │   └── google/            Gemini via @google/generative-ai.
│   │
│   └── orchestrator-agent/
│       ├── agent-loop.ts      The core conversational loop. User message in → model decides
│       │                      which tools to call → tools execute → results feed back → repeats
│       │                      until plain-text answer or round cap. Replaces hardcoded dispatch.
│       ├── tool-registry.ts   Stores ToolDefinitions, looks them up by name for dispatch.
│       ├── system-prompt.ts   Agent persona and rules, built from session context.
│       └── session.ts         Conversation history + mutable context (repo, branch, DNA summary).
│
├── src/                       The existing working layer. Being migrated into the packages
│   │                          architecture incrementally — tools will move here as they're
│   │                          wrapped as ToolDefinitions for the orchestrator.
│   │
│   ├── cli/
│   │   ├── repl.ts            Interactive shell (currently hardcoded dispatch; being replaced
│   │   │                      by orchestrator-agent loop in the next phase).
│   │   ├── solve-command.ts   One-shot pipeline: fetch → DNA → plan → branch → heal → PR.
│   │   ├── dna-command.ts     Standalone DNA inspection.
│   │   └── config-command.ts  Env var validation.
│   │
│   ├── dna/
│   │   ├── extract.ts         One ts-morph Project, one parse pass, all analyzers.
│   │   └── analysis/          11 analyzers: files, imports, exports, functions, helpers,
│   │                          callgraph, architecture, naming, errors, patterns, dependencies.
│   │
│   ├── semantic/
│   │   ├── embeddings.ts      Embeddings API client + cosine similarity.
│   │   └── file-index.ts      In-memory semantic index, brute-force cosine scoring.
│   │
│   ├── github/                fetch-issue.ts (with comments), parse-issue-url.ts.
│   ├── issue/                 issue-mapper.ts: keywords → candidate files/functions/helpers.
│   ├── planner/               planner.ts (step list), planner-agent.ts (LLM file selection).
│   │
│   ├── llm/
│   │   ├── nim-client.ts      Legacy direct NIM client. Superseded by packages/providers/nim.
│   │   └── prompt-builder.ts  Fix prompt + sliding-window retry prompt.
│   │
│   ├── healing/
│   │   ├── apply-fix.ts       SEARCH/REPLACE block parser + safe file writer.
│   │   ├── run-tests.ts       Test runner with timeout, captures stdout/stderr.
│   │   └── self-heal-loop.ts  Generate → apply → test → retry loop.
│   │
│   ├── git/                   create-branch (+ dirty-dir guard), checkout, commit, push-and-pr.
│   └── config.ts              Env loading with defaults.
│
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

---

## Design notes

**Why the `Provider` interface instead of LangChain.** LangChain is a large framework with strong opinions about how agents, chains, and tools are structured. For a CLI tool with a specific, known set of operations, the overhead of fighting LangChain's abstractions outweighs any benefit. The `Provider` interface in `packages/providers/provider.ts` is 12 lines — `chat()` and `embed()`. Adding a new provider means implementing those two methods. That's the entire integration cost.

**Why `packages/` and `src/` coexist right now.** The new architecture is being migrated in from the outside in. `packages/core` and `packages/providers` are done and stable. `packages/orchestrator-agent` is done and tested. The next step is wrapping the existing capabilities in `src/` (DNA extraction, healing, git operations) as `ToolDefinition` objects the agent loop can call — at which point `src/` shrinks to thin wrappers over those underlying functions, and eventually disappears. Keeping both layers compiling and running during the transition means nothing breaks in the meantime.

**Why SEARCH/REPLACE blocks instead of full-file dumps.** Asking a model to output an entire file just to fix one function is slow, burns tokens, and risks the model silently dropping code it didn't bother to repeat. SEARCH/REPLACE is surgical: the exact text to find, the exact replacement. If the SEARCH text doesn't match the file's actual content verbatim, the edit is rejected rather than corrupting the file, and that non-match surfaces back to the model as a failed attempt to retry.

**Why no vector database for semantic search.** At the scale of a single repository — hundreds to a few thousand files — brute-force cosine similarity over an in-memory array produces results in milliseconds and adds zero infrastructure. A vector database would add meaningful operational complexity (process to run, data to persist, version to upgrade) for no measurable quality improvement at this scale.

**Why the agent loop uses a sliding-window retry prompt.** Including the full history of every failed fix attempt in each retry would grow the prompt linearly with attempt count, risking a context-length error at exactly the moment the loop is trying hardest to recover. Only the single most recent attempt and its test error output are included, keeping prompt size roughly constant across all retries.

**Why the agent loop emits events instead of printing directly.** The loop knows nothing about whether it's being driven by a TUI, a REPL, or a CI script. It emits `AgentEvent` values (`tool_call_start`, `text_delta`, `turn_end`, `error`) to an `AgentEventBus`. The TUI subscribes to these events and decides how to render them. Swapping the display layer requires zero changes to the loop.

**Why the dirty-working-directory guard exists.** If you run resolv while you have uncommitted changes, and the pipeline creates a branch and commits, your in-progress work gets bundled into the automated commit. That's a bad situation to be in — your uncommitted code is now "the fix" rather than "your work in progress." The guard throws before anything else happens.

---

## Troubleshooting

**`Cannot find module '...'` on startup** — you ran `node dist/bin/resolv.js` without building first, or you edited a source file and forgot to rebuild. Run `npm run build` and retry.

**`Working directory has uncommitted changes`** — resolv is protecting your in-progress work. `git status` in the target repo, then `git stash` or `git commit` before retrying.

**`Missing NVIDIA_API_KEY` / `Missing ANTHROPIC_API_KEY` / etc.** — run `resolv config` to see exactly which variables are set and missing. Make sure the export happened in the same shell session you're running resolv from (exporting in one terminal tab doesn't carry over to another).

**`NVIDIA NIM request failed: 401`** — your API key is invalid or expired. Get a fresh one at https://build.nvidia.com.

**`Unknown provider: "..."` / `Check RESOLV_PROVIDER`** — the value you set for `RESOLV_PROVIDER` isn't one of `nim`, `anthropic`, or `google`. Check for typos.

**`Prompt too large (~N estimated tokens...)`** — the token circuit breaker fired before sending the request. The relevant files were too large to fit in the prompt budget. Try `--no-semantic` to narrow the candidate file set, or move the target repo and run from a subdirectory if it's a very large monorepo.

**`The model never produced a parseable SEARCH/REPLACE response`** — across all retry attempts, the model returned prose or code without following the required `<<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE` format. Try a different model (`RESOLV_MODEL=...`) — instruction-following quality varies significantly between models.

**Tests keep failing after all retry attempts** — either the fix genuinely doesn't work, or `RESOLV_TEST_COMMAND` isn't the right command for this repo (verify it runs cleanly by hand first). Your local branch (`fix/issue-<number>`) has the last attempt on it for manual inspection.

**No PR was opened even though tests passed** — either `GITHUB_TOKEN` isn't set (fix stays on a local branch, which is expected — check the terminal output for the branch name), or the token lacks write access to the repo (you'll see a warning explaining what failed; the branch is still local and safe).

**Semantic search fails with an embedding error, then continues anyway** — this is intentional. If the embedding API call fails (rate limit, model unavailable, provider doesn't support embeddings), resolv logs a warning and falls back to keyword-only file matching. The pipeline continues. If you want to disable semantic search entirely from the start, pass `--no-semantic`.

---

## Known limitations and what's next

**What's verified working right now:**
- Full `resolv solve` pipeline: issue fetch, DNA extraction, keyword + semantic candidate finding, planner agent, SEARCH/REPLACE fix generation, self-healing test loop, commit, PR opening.
- All three provider implementations (NIM, Anthropic, Gemini) compile and translate to/from the provider-agnostic format correctly. Verified with real API calls against the NIM provider; Anthropic and Gemini use the same translation pattern.
- The `orchestrator-agent` loop is fully implemented and tested with scripted stub providers covering: normal tool-call-then-answer flow, infinite-tool-calling model stopped by the round cap, and hallucinated tool names handled without crashing the session.
- `resolv dna` and `resolv config` work and are useful standalone.

**What the next build phase will add:**
- Wrapping all existing capabilities (DNA extraction, file reading, SEARCH/REPLACE apply, test running, git operations, PR opening) as `ToolDefinition` objects the orchestrator-agent can call — completing the move to the conversational agent model.
- Replacing the REPL's hardcoded command dispatcher with the `agent-loop.ts`, enabling free-text messages like "that fix broke the auth middleware, look at it again" instead of rigid commands.
- A proper TUI (using Ink, the React-for-terminals library that Claude Code itself uses) with live tool-call progress rendering, a proper chat view, and slash commands (`/model`, `/clear`, `/help`).
- A `coding-agent` package (the "one who actually makes changes") and a `context-agent` package (the "one who fetches issue/DNA/semantic data") as separate tool sets, so the orchestrator can reason about them independently.

**Current known limitations:**
- File scanning uses a hardcoded ignore list (`node_modules`, `.git`, `dist`, etc.) rather than respecting the target repo's actual `.gitignore`.
- No GitHub API rate-limit handling — heavy use without a `GITHUB_TOKEN` will eventually hit 403 responses from the GitHub API.
- The Anthropic provider has no embeddings support (Anthropic doesn't offer a public embeddings endpoint), so semantic search automatically falls back to keyword matching when using that provider.
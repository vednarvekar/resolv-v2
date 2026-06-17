# resolv

**In-context, style-matching issue resolver CLI.**

Most AI coding tools write code "their own way" on a repo — ignoring existing helpers, breaking naming conventions, importing new dependencies nobody asked for. Maintainers reject PRs like that on sight.

`resolv` behaves like a senior engineer who already works on the codebase. Before writing a single line, it scans the repo to build a style "DNA" profile — naming convention, error-handling pattern, async style, the most-reused internal helpers, architecture layers — and forces the LLM to match that profile exactly when generating a fix. The goal is a PR that looks like it came from someone who's been on the team for months, not a bot.

---

## Table of contents

1. [Requirements](#requirements)
2. [Installation](#installation)
3. [Configuration (environment variables)](#configuration-environment-variables)
4. [How to run it](#how-to-run-it)
5. [Commands reference](#commands-reference)
6. [What actually happens when you run `solve`](#what-actually-happens-when-you-run-solve)
7. [Project structure](#project-structure)
8. [Design notes — why things were built this way](#design-notes--why-things-were-built-this-way)
9. [Troubleshooting](#troubleshooting)
10. [Known limitations](#known-limitations)

---

## Requirements

- Node.js **18+** (uses native `fetch`, top-level `await`, ESM)
- npm
- Git, installed and on your `PATH`
- A free [NVIDIA NIM](https://build.nvidia.com) API key (required)
- A [GitHub Personal Access Token](https://github.com/settings/tokens) with `repo` scope (optional — only needed if you want resolv to push branches and open PRs automatically)

---

## Installation

Clone or unzip the project, then from the project root:

```bash
npm install
```

This installs all dependencies: `ts-morph` (AST analysis), `commander` (CLI parsing), `@octokit/rest`/`octokit` (GitHub API), `chalk` + `ora` (terminal output).

Then build it:

```bash
npm run build
```

This compiles everything in `bin/` and `src/` from TypeScript into `dist/`, using the `tsc` compiler. You should see no output on success (a clean `tsc` run is silent).

---

## Configuration (environment variables)

Copy the example env file and fill it in:

```bash
cp .env.example .env
```

Then either `export` each variable in your shell, or use a tool like `dotenv-cli` / `direnv` to load `.env` automatically — resolv itself reads from `process.env`, it does not load `.env` files for you.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NVIDIA_API_KEY` | **Yes** | — | Auth for NVIDIA NIM (chat completions + embeddings). Get a free key at https://build.nvidia.com |
| `GITHUB_TOKEN` | No | — | Needed to fetch private issues, push the fix branch, and open a PR. Without it, public issues still work and the fix is committed locally but never pushed. |
| `RESOLV_MODEL` | No | `meta/llama-3.3-70b-instruct` | Which NIM chat model to use for planning + fix generation. |
| `RESOLV_TEST_COMMAND` | No | `npm test` | The command run after each fix attempt to check if it actually works. Set this to whatever your target repo actually uses (`pytest`, `yarn test`, `go test ./...`, etc). |
| `RESOLV_MAX_ATTEMPTS` | No | `4` | How many times the self-healing loop will retry generating a fix if tests keep failing. |

Quick example, exporting directly in your shell:

```bash
export NVIDIA_API_KEY="nvapi-xxxxxxxxxxxxxxxx"
export GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxx"
export RESOLV_TEST_COMMAND="npm test"
```

Verify everything is set correctly before running anything else:

```bash
node dist/bin/resolv.js config
```

This prints which variables are set/missing and tells you whether you're ready to run `solve`. It exits with code `1` if `NVIDIA_API_KEY` is missing, so you can use it in scripts/CI too.

---

## How to run it

There are two ways to run resolv: **built** (recommended, what you'll actually ship/use day to day) or **dev mode** (faster iteration while editing the code itself).

### Option A — Built (recommended)

```bash
npm run build
node dist/bin/resolv.js <command> [args] [options]
```

Example:

```bash
node dist/bin/resolv.js dna --path ~/code/some-repo
node dist/bin/resolv.js solve https://github.com/owner/repo/issues/123 --path ~/code/some-repo
```

### Option B — Dev mode (no build step, runs TypeScript directly via `tsx`)

```bash
npx tsx bin/resolv.ts <command> [args] [options]
```

Or using the npm script shortcut (equivalent to the line above, but only for the default no-argument case — for passing arguments, call `tsx` directly as above):

```bash
npm run dev
```

### Option C — Install it globally as a real `resolv` command

After building, you can link it so you can just type `resolv` from anywhere:

```bash
npm run build
npm link
```

Then:

```bash
resolv dna --path ~/code/some-repo
resolv solve https://github.com/owner/repo/issues/123 --path ~/code/some-repo
```

(Run `npm unlink -g resolv` later if you want to remove it.)

---

## Commands reference

### `resolv config`

Checks your environment setup. No LLM calls, no git operations, no network access beyond reading `process.env`. Run this first, always.

```bash
resolv config
```

Output tells you exactly which env vars are set and which are missing, plus whether you're ready to run `solve`.

---

### `resolv dna`

Scans a local repository and prints its full style DNA — no LLM, no GitHub, no git writes. Completely safe to run on anything, including repos you don't own and have no token for. Great for demos or just understanding an unfamiliar codebase before you touch it.

```bash
resolv dna --path /path/to/repo
```

**Options:**

| Flag | Description |
|---|---|
| `-p, --path <path>` | Path to the local repo to scan. Defaults to your current directory. |
| `--json <outputPath>` | Instead of printing a human-readable summary, write the entire DNA profile as JSON to this file path. |

Examples:

```bash
# Pretty summary in the terminal
resolv dna --path .

# Full machine-readable profile, e.g. to feed into another tool or just inspect by hand
resolv dna --path ~/code/zulip --json zulip-dna.json
```

What you'll see in the summary: file/function/helper/dependency counts, the dominant naming convention (camelCase / snake_case / PascalCase / SCREAMING_SNAKE) with raw counts, the dominant error-handling style (try-catch / promise-catch / result-type / callback-err), the dominant async style (async-await / promise-chain / callbacks), the top 10 most-reused internal helper functions, a breakdown of detected architecture layers (routes/controllers/services/repositories), and any dependencies declared in `package.json` that are never actually imported anywhere.

---

### `resolv solve <issue-url>`

The full pipeline. Fetches a GitHub issue, analyzes the target repo, generates a style-matched fix using NVIDIA NIM, runs your tests, retries on failure, and (if you have a `GITHUB_TOKEN`) pushes a branch and opens a PR.

```bash
resolv solve <github-issue-url> [options]
```

**Argument:**

| Argument | Description |
|---|---|
| `<issue-url>` | Full GitHub issue URL, e.g. `https://github.com/owner/repo/issues/123` |

**Options:**

| Flag | Description |
|---|---|
| `-p, --path <path>` | Path to your **local clone** of the repo the issue belongs to. Defaults to your current directory. This must be an actual git repository with a clean working tree. |
| `--no-semantic` | Skip semantic search + the planner agent; use plain keyword matching only. Faster and avoids the extra NIM embedding API calls — useful while iterating or if you want to minimize API usage. |

Examples:

```bash
# Full run, from inside the cloned repo
cd ~/code/some-open-source-repo
resolv solve https://github.com/owner/some-open-source-repo/issues/456

# Same thing, pointing at the repo explicitly instead of cd-ing into it
resolv solve https://github.com/owner/some-open-source-repo/issues/456 --path ~/code/some-open-source-repo

# Faster/cheaper run, keyword matching only, no semantic search or planner agent
resolv solve https://github.com/owner/repo/issues/456 --no-semantic
```

**Important:** the repo at `--path` must have **no uncommitted changes**. resolv refuses to run on a dirty working directory so it never mixes its own automated commits with your in-progress work. Commit or stash first.

---

## What actually happens when you run `solve`

1. **Clean check.** Verifies the target repo has no uncommitted changes. Aborts immediately if it does.
2. **Fetch the issue.** Pulls the issue title, body, and all comments from the GitHub API (comments matter — maintainers often clarify the actual root cause there, not in the original post).
3. **Extract DNA.** Parses the whole repo once with a shared `ts-morph` AST pass and derives: file inventory, imports/exports, every function's shape, the most-reused internal helper functions, a function call graph, architecture layer detection (route/controller/service/repository), the dominant naming convention, the dominant error-handling pattern, the dominant async style, and which `package.json` dependencies are actually used.
4. **Find candidate files.** Two parallel passes: keyword matching (issue text against file paths/function names) and semantic search (embeds the issue text and every file/function summary, ranks by cosine similarity — no vector database, just an in-memory array, since a single repo is small enough that this is plenty fast).
5. **Plan.** A dedicated NIM call (the "planner agent") looks at both candidate pools and judges which files/functions actually need to change — this replaces naive "does the filename contain a keyword" matching with real judgment. If this call fails or returns something unparseable, it falls back to the keyword-matched list automatically, so the pipeline never hard-stops here.
6. **Create a safety branch.** `fix/issue-<number>`, so your main branch is never touched.
7. **Generate + self-heal.** Builds a prompt that includes the actual source of the relevant files plus the repo's style profile, sends it to NVIDIA NIM, and asks for the fix as small SEARCH/REPLACE blocks (not whole-file dumps — cheaper, faster, and safer since a non-matching SEARCH block is rejected rather than silently corrupting the file). Applies the edit, runs your test command, and if it fails, feeds the error back to the model and retries — up to `RESOLV_MAX_ATTEMPTS` times. Each retry prompt only includes the most recent failure (a sliding window), so the prompt doesn't grow without bound across retries.
8. **Commit.** If tests pass, commits the change with a message referencing the issue number.
9. **Push + open PR.** If `GITHUB_TOKEN` is set, pushes the branch and opens a PR against the repo's default branch. If push or PR creation fails for any reason (no write access, bad token, network issue), the failure is caught and reported — your fix is never lost, it just stays on the local branch for you to push by hand.

If no `GITHUB_TOKEN` is set at all, steps 9 is skipped entirely and you're told exactly which local branch has the working fix.

---

## Project structure

```
bin/
  resolv.ts                    CLI entry point (commander) — registers solve/dna/config

src/
  cli/
    solve-command.ts           orchestrates the entire pipeline end to end
    dna-command.ts             standalone DNA inspection, no LLM/git involved
    config-command.ts          environment variable validation

  dna/
    extract.ts                 builds ONE ts-morph Project, parses once, fans out to every analyzer below
    types.ts                   shared types for the whole DNA system
    analysis/
      files.ts                 filesystem walk, language detection, line counts
      imports.ts                ts-morph AST for JS/TS; regex fallback for Python (no AST tool wired in for it)
      exports.ts                same JS/TS-vs-Python split as imports.ts
      functions.ts              every function/method/arrow: params, async flag, line count
      helpers.ts                 which internal calls get reused most, and across how many files
      callgraph.ts                maps each function to what it calls
      architecture.ts            detects route / controller / service / repository layers
      naming.ts                  camelCase vs snake_case vs PascalCase vs SCREAMING_SNAKE, from real AST identifiers (not raw text)
      errors.ts                  try/catch vs .catch() vs Result-type vs callback-err patterns, plus custom Error subclasses
      patterns.ts                 async/await vs promise chains vs callback style, per file
      dependencies.ts             package.json cross-referenced against actual import usage — flags unused deps
      structure.ts                 folder hierarchy map

  semantic/
    embeddings.ts                NIM embeddings API client + cosine similarity function
    file-index.ts                 builds an in-memory semantic index over files + functions, ranks by similarity to a query

  github/
    parse-issue-url.ts            parses an issue URL into owner/repo/number
    fetch-issue.ts                 fetches the issue AND its comments

  issue/
    issue-mapper.ts                keyword extraction from issue text+comments -> candidate files/functions/helpers

  planner/
    planner.ts                     turns a candidate mapping into a human-readable step list
    planner-agent.ts                the LLM subagent that judges keyword+semantic candidates down to real targets

  llm/
    nim-client.ts                   NVIDIA NIM chat completions client, with a token-budget circuit breaker that refuses oversized prompts before sending
    prompt-builder.ts                builds the fix-generation prompt (includes real source snippets, capped in size) and the sliding-window retry prompt

  healing/
    apply-fix.ts                     parses SEARCH/REPLACE blocks (or full-file dumps for brand-new files) out of the model's response and writes them to disk safely
    run-tests.ts                      runs the configured test command with a timeout, captures stdout/stderr
    self-heal-loop.ts                 the retry loop: generate -> apply -> test -> on failure, retry with error feedback, up to max attempts

  git/
    create-branch.ts                  branch creation + the dirty-working-directory guard
    checkout.ts                        branch checkout + current-branch lookup
    commit.ts                          stages and commits changes
    push-and-pr.ts                     pushes the branch and opens a PR; never throws — returns a structured success/failure so a working fix is never lost even if the push/PR step fails

  config.ts                           reads and validates environment variables, with defaults
```

---

## Design notes — why things were built this way

**Why `ts-morph` instead of regex for JS/TS analysis.** Regex-based import/export parsing breaks on multi-line imports, generics, and re-exports. `ts-morph` parses correctly and is reused as a *single* `Project` instance across every analyzer in `dna/analysis/`, so the repo's source is parsed once total, not once per analysis module. Python has no equivalent AST tool wired in here, so it falls back to line-based regex for imports/exports — a known, accepted limitation rather than an oversight.

**Why SEARCH/REPLACE blocks instead of full-file dumps.** Asking a model to return an entire file just to fix one line is slow, burns tokens, and risks the model silently dropping unrelated code it didn't bother to repeat. SEARCH/REPLACE is surgical: if the search text doesn't match the file's actual content verbatim, the edit is rejected outright rather than corrupting the file, and that counts as a failed attempt that the self-heal loop will retry.

**Why semantic search and the planner agent are optional, degrading layers, not hard dependencies.** Embedding calls cost tokens, add latency, and require network access. If they fail, or if you pass `--no-semantic`, the pipeline falls back to plain keyword matching — which works perfectly well on its own, just with somewhat less precise file targeting.

**Why there's no vector database.** At the scale of a single repository (hundreds to low thousands of files/functions), brute-force cosine similarity over an in-memory array is faster to build, easier to reason about, and avoids bolting an infrastructure dependency onto what should be a simple CLI tool.

**Why the retry prompt uses a sliding window.** Including the full history of every failed attempt in each retry would make the prompt grow linearly with attempt count — which risks hitting a context-length error at exactly the moment the loop is trying hardest to recover. Only the single most recent attempt and its error are included in each retry.

---

## Troubleshooting

**`Cannot find module '../src/cli/solve-command.js'`** — you're running the compiled `dist/bin/resolv.js` without having run `npm run build` first, or you edited a `src/` file and forgot to rebuild. Run `npm run build` again.

**`Working directory has uncommitted changes`** — resolv refuses to run on a dirty repo on purpose. `git status` in your target repo, then `git commit` or `git stash` before retrying.

**`Missing NVIDIA_API_KEY`** — run `resolv config` to confirm it's actually set in the shell you're running resolv from (exporting it in one terminal tab doesn't carry over to another).

**`NVIDIA NIM request failed: 401`** — your API key is invalid or expired. Get a fresh one at https://build.nvidia.com.

**`Prompt too large (~N estimated tokens...)`** — the files resolv tried to include as context were too large combined. This is the token circuit breaker working as intended, not a crash. Try `--no-semantic` to reduce the candidate file set, or manually narrow `--path` to a smaller subdirectory if the repo is huge.

**The model never produced a parseable SEARCH/REPLACE response** — the LLM ignored the required response format across all retry attempts. Try a different `RESOLV_MODEL` — instruction-following quality varies a lot between models on NIM.

**Tests keep failing after `RESOLV_MAX_ATTEMPTS` retries** — the fix genuinely isn't working, or your `RESOLV_TEST_COMMAND` isn't actually the right command for this repo (double check it runs cleanly by hand first, outside of resolv). Your local branch (`fix/issue-<number>`) still has the last attempt on it if you want to inspect what the model tried.

**No PR was opened even though tests passed** — either `GITHUB_TOKEN` isn't set (fix stays local, this is expected — check the printed message for the branch name) or the token lacks write access to that specific repo (you'll see a warning explaining exactly what failed; the branch is still pushed/committed locally either way).

---

## Known limitations

- The full `solve` pipeline has been verified component-by-component (DNA extraction, the SEARCH/REPLACE parser, the dirty-directory guard, the planner agent's JSON parsing, the PR fallback path) but has not yet been run end-to-end against a live NVIDIA NIM key plus a real GitHub issue.
- File scanning uses a hardcoded ignore list (`node_modules`, `.git`, `dist`, `build`, etc.) rather than respecting the target repo's actual `.gitignore`.
- No GitHub API rate-limit handling — heavy usage without a `GITHUB_TOKEN` will eventually hit 403 responses.
- Semantic search and the planner agent add real latency and NIM API cost to every `solve` run; use `--no-semantic` when you want to skip that cost during iteration or testing.
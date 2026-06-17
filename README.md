# resolv

In-context, style-matching issue resolver CLI. Instead of writing code "its own way," resolv analyzes a repository's DNA first — naming conventions, error-handling patterns, async style, frequently reused helpers, architecture layers — then forces the LLM to match that style when generating a fix, so the resulting PR looks like it was written by someone who already works on the codebase.

## Setup

```bash
npm install
npm run build
```

Required environment variable:

```bash
export NVIDIA_API_KEY="your-key"   # free tier at https://build.nvidia.com
```

Optional:

```bash
export GITHUB_TOKEN="your-pat"             # needed to push branches + open PRs; without it, fixes stay local
export RESOLV_MODEL="meta/llama-3.3-70b-instruct"
export RESOLV_TEST_COMMAND="npm test"
export RESOLV_MAX_ATTEMPTS="4"
```

Check your setup any time with:

```bash
node dist/bin/resolv.js config
```

## Commands

### `resolv dna`

Analyzes a repo's style DNA without touching any LLM or git state. Useful for demos, sanity-checking the analyzer, or just understanding a codebase before you start.

```bash
node dist/bin/resolv.js dna --path /path/to/repo
node dist/bin/resolv.js dna --path /path/to/repo --json out.json   # full profile as JSON
```

### `resolv solve <issue-url>`

The full pipeline: fetch issue, extract DNA, build a candidate file list (keyword + semantic search), let a planner agent pick the actual targets, generate a fix via NVIDIA NIM, apply it with SEARCH/REPLACE-style surgical edits, run your tests, retry on failure (sliding-window prompt so retries don't blow the context window), commit, push, open a PR.

```bash
node dist/bin/resolv.js solve https://github.com/owner/repo/issues/123 --path /path/to/local/clone
```

Flags:
- `-p, --path <path>` — local repo path (defaults to cwd)
- `--no-semantic` — skip semantic search + planner agent, use plain keyword matching only (faster, no embedding API cost)

## Architecture

```
bin/resolv.ts                  CLI entry (commander)

src/
  cli/
    solve-command.ts           orchestrates the full pipeline
    dna-command.ts             standalone DNA inspection
    config-command.ts          env var validation

  dna/
    extract.ts                 single ts-morph Project, one parse pass, fans out to analyzers
    types.ts
    analysis/
      files.ts                 fs walk, language detection, line counts
      imports.ts                ts-morph AST for JS/TS, regex fallback for Python
      exports.ts                 same split
      functions.ts              function/method/arrow shapes, params, async, size
      helpers.ts                 most-reused internal call targets
      callgraph.ts                function -> what it calls
      architecture.ts            route/controller/service/repository layer detection
      naming.ts                  camelCase/snake_case/PascalCase/SCREAMING_SNAKE counts from real identifiers
      errors.ts                  try/catch vs .catch() vs Result types vs custom Error classes
      patterns.ts                 async/await vs promise chains vs callback style
      dependencies.ts             package.json cross-referenced against actual import usage
      structure.ts                 folder hierarchy

  semantic/
    embeddings.ts               NIM embeddings API client + cosine similarity
    file-index.ts                in-memory semantic index over files/functions (no vector DB)

  github/
    parse-issue-url.ts
    fetch-issue.ts              fetches issue + comments

  issue/
    issue-mapper.ts             keyword extraction -> candidate files/functions/helpers

  planner/
    planner.ts                  turns a mapping into a human-readable step list
    planner-agent.ts            LLM subagent: judges keyword+semantic candidates down to actual targets

  llm/
    nim-client.ts                NVIDIA NIM chat completions, with a token-budget circuit breaker
    prompt-builder.ts            builds the fix prompt (with real source snippets) + sliding-window retry prompt

  healing/
    apply-fix.ts                 parses SEARCH/REPLACE blocks (or full-file dumps for new files), applies them safely
    run-tests.ts                  runs the test command with a timeout, captures output
    self-heal-loop.ts             generate -> apply -> test -> retry on failure, up to maxAttempts

  git/
    create-branch.ts              branch creation + dirty-working-directory guard
    checkout.ts
    commit.ts
    push-and-pr.ts                push + open PR, never throws — returns a structured failure so a local fix is never lost

  config.ts                       env var loading with defaults
```

## Design notes

**Why ts-morph instead of regex for JS/TS.** Regex-based import/export parsing breaks on multi-line imports, generics, and re-exports. ts-morph gives correct results and is reused as a single `Project` instance across every analyzer, so the repo's source is parsed once, not once per module. Python has no equivalent AST tool wired in, so it falls back to line-based regex — accepted limitation, not a bug.

**Why SEARCH/REPLACE instead of full-file dumps.** Asking the model to return whole files for a one-line fix is slow, expensive, and risks silently dropping unrelated code. SEARCH/REPLACE blocks are surgical: if the search text doesn't match the file verbatim, the edit is rejected rather than corrupting the file, and the self-heal loop treats that as a failed attempt and retries.

**Why semantic search is optional and degrades gracefully.** Embedding calls cost tokens and require network access; if they fail or `--no-semantic` is passed, the pipeline falls back to pure keyword matching, which still works on its own — semantic search and the planner agent are a quality improvement layer, not a hard dependency.

**Why no vector database.** At the scale of a single repo (hundreds to low thousands of files/functions), an in-memory array with brute-force cosine similarity is simpler to reason about and faster to build than standing up Pinecone/Chroma/etc., and avoids adding an infra dependency to a CLI tool.

**Why the retry prompt is a sliding window.** Feeding the full history of every failed attempt into each retry would grow the prompt linearly with attempt count, risking a context-length error exactly when the loop is trying hardest to recover. Only the most recent attempt and its error are included.

## Known limitations

- The full pipeline (`resolv solve`) has been tested component-by-component but not yet against a live NVIDIA NIM key + real GitHub issue end-to-end.
- File scanning ignores a hardcoded list of directories (`node_modules`, `.git`, `dist`, etc.) rather than respecting the repo's actual `.gitignore`.
- No GitHub API rate-limit handling — heavy use without a `GITHUB_TOKEN` will hit 403s.
- The planner agent and semantic search add real latency and NIM API cost per run; `--no-semantic` exists specifically to skip this when iterating quickly.

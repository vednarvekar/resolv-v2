# packages/dna

Extracts a compact "DNA" profile from a codebase. The profile tells the LLM what style to match — without dumping raw AST data that wastes context.

## Design principle: lean output

The DNA JSON is intentionally small. For a 40-file repo, it should stay under 200KB (not 7000 lines). This is achieved by:

- **No anonymous arrow functions** — they add 200+ entries with zero useful signal
- **No per-file import maps** — the LLM doesn't need to know every import in every file
- **No raw call graph text** — giant call lists with native builtins removed
- **Dominant styles only** — one label per style axis (`dominantNaming`, `dominantAsyncStyle`, `dominantErrorStyle`), not per-file counts
- **Helpers capped at 30** — only genuinely cross-file utilities (used in 2+ files)
- **Architecture: file names only** — no import/call arrays per file

## What IS included

- `files[]` — relative path, language, line count
- `exports{}` — per-file exported names + types
- `functions[]` — named functions and methods only
- `functionStats` — total count, avg size, async percentage
- `helpers[]` — cross-file utilities with usage counts
- `architecture` — routes/controllers/services/repositories (file names)
- `dominantNaming` — camelCase / snake_case / PascalCase / mixed
- `dominantAsyncStyle` — async-await / promise-chain / mixed
- `dominantErrorStyle` — try-catch / promise-catch / none
- `dependencies[]` — from package.json with usage counts

## Files

| File | Responsibility |
|------|---------------|
| `extract.ts` | Entry point — builds ts-morph Project once, runs all analyzers |
| `types.ts` | All DNA types — the source of truth for what's in the profile |
| `analysis/files.ts` | File scan with .gitignore awareness |
| `analysis/functions.ts` | Named functions + methods (no anonymous arrows) |
| `analysis/exports.ts` | Per-file export index |
| `analysis/helpers.ts` | Cross-file utility detection |
| `analysis/architecture.ts` | Layer classification (route/controller/service/repo) |
| `analysis/errors.ts` | Error handling style per file |
| `analysis/patterns.ts` | Async style per file |
| `analysis/dependencies.ts` | package.json deps with import usage counts |

## .gitignore support

`extract.ts` reads `.gitignore` at the repo root and passes patterns to `files.ts`, which skips matching entries during the walk. Standard patterns (`node_modules`, `dist`, etc.) are always skipped regardless.

## Deprecated
- `callgraph.ts, imports.ts, naming.ts, structure.ts` files are no longer used for DNA analysis.
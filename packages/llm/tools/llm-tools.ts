// packages/llm/llm-tools.ts
// Tool definitions available to the conversational agent.
// Tools: read_file, write_file, list_directory, grep_codebase,
//        scan_repo_dna, run_tests, fetch_github_issue, search_web

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { extractDNA } from "../../dna/extract.js";
import { runTests } from "../../coding-agent/run-tests.js";
import type { ToolDefinition } from "../../core/types.js";
import { parseIssueUrl } from "../../context-agent/github/parse-issue-url.js";
import { fetchIssue } from "../../context-agent/github/fetch-issue.js";
import { searchWeb, formatSearchResults } from "../tools/web-search.js";

function safeResolvePath(repoRoot: string, relativePath: string): string {
  const resolved = path.resolve(repoRoot, relativePath);
  if (!resolved.startsWith(path.resolve(repoRoot))) {
    throw new Error("Path escapes the repository root");
  }
  return resolved;
}

function readGitignorePatterns(repoRoot: string): Set<string> {
  const gitignorePath = path.join(repoRoot, ".gitignore");
  if (!fs.existsSync(gitignorePath)) return new Set();
  return new Set(
    fs.readFileSync(gitignorePath, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
  );
}

function isIgnored(relativePath: string, gitignorePatterns: Set<string>): boolean {
  const parts = relativePath.split(path.sep);
  for (const pattern of gitignorePatterns) {
    if (parts.some((p) => p === pattern)) return true;
    if (relativePath.includes(pattern)) return true;
  }
  return false;
}

const ALWAYS_SKIP = new Set(["node_modules", ".git", "dist", "build", ".next"]);
const DEFAULT_SOURCE_GLOBS = ["*.ts", "*.tsx", "*.js", "*.jsx", "*.py", "*.json", "*.md"];

function expandFileGlobs(fileGlob: string): string[] {
  const match = fileGlob.match(/^(.*)\{([^}]+)\}(.*)$/);
  if (!match) return [fileGlob];

  const prefix = match[1] ?? "";
  const variants = match[2] ?? "";
  const suffix = match[3] ?? "";
  return variants.split(",").map((variant) => `${prefix}${variant}${suffix}`);
}

function searchCodebase(repoRoot: string, pattern: string, fileGlob: string): string {
  const globs = fileGlob ? expandFileGlobs(fileGlob) : DEFAULT_SOURCE_GLOBS;

  try {
    return execFileSync(
      "git",
      ["-C", repoRoot, "grep", "-n", "-i", "-m", "3", pattern, "--", ...globs],
      { encoding: "utf-8", timeout: 10_000 },
    ).trim();
  } catch {
    const includeArgs = globs.flatMap((glob) => ["--include", glob]);
    const result = execFileSync(
      "grep",
      ["-r", "-n", "-i", "-m", "3", pattern, ...includeArgs, repoRoot],
      { encoding: "utf-8", timeout: 10_000 },
    ).trim();
    return result;
  }
}

export function createLLMTools(repoRoot: string): ToolDefinition[] {
  const gitignorePatterns = readGitignorePatterns(repoRoot);

  return [
    // ── read_file ────────────────────────────────────────────
    {
      name: "read_file",
      description: "Read a file from the repository. Path is relative to repo root. Respects .gitignore.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to repo root" },
        },
        required: ["path"],
      },
      async execute(input) {
        const filePath = String(input.path ?? "");
        if (isIgnored(filePath, gitignorePatterns)) {
          return { output: `File is in .gitignore: ${filePath}`, isError: true };
        }
        const absPath = safeResolvePath(repoRoot, filePath);
        if (!fs.existsSync(absPath)) {
          return { output: `File not found: ${filePath}`, isError: true };
        }
        const stat = fs.statSync(absPath);
        if (!stat.isFile()) {
          return { output: `Not a file: ${filePath}`, isError: true };
        }
        // Cap at 20KB to avoid blowing context
        const content = fs.readFileSync(absPath, "utf-8");
        const MAX = 20_000;
        if (content.length > MAX) {
          return { output: content.slice(0, MAX) + `\n\n...(truncated at ${MAX} chars, file is ${content.length} chars total)`, isError: false };
        }
        return { output: content, isError: false };
      },
    },

    // ── write_file ───────────────────────────────────────────
    {
      name: "write_file",
      description: "Write content to a file in the repository. Creates parent directories if needed. Use for applying fixes.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to repo root" },
          content: { type: "string", description: "Content to write" },
        },
        required: ["path", "content"],
      },
      async execute(input) {
        const filePath = String(input.path ?? "");
        const content = String(input.content ?? "");
        if (isIgnored(filePath, gitignorePatterns)) {
          return { output: `Refusing to write to a .gitignore path: ${filePath}`, isError: true };
        }
        const absPath = safeResolvePath(repoRoot, filePath);
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, content, "utf-8");
        return { output: `Written: ${filePath} (${content.length} chars)`, isError: false };
      },
    },

    // ── list_directory ───────────────────────────────────────
    {
      name: "list_directory",
      description: "List files and directories. Path is relative to repo root.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path (default: repo root)" },
        },
      },
      async execute(input) {
        const dir = String(input.path ?? ".");
        const absPath = safeResolvePath(repoRoot, dir);
        if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
          return { output: `Directory not found: ${dir}`, isError: true };
        }
        const entries = fs.readdirSync(absPath)
          .filter((e) => !ALWAYS_SKIP.has(e))
          .sort()
          .map((e) => {
            const full = path.join(absPath, e);
            return fs.statSync(full).isDirectory() ? `${e}/` : e;
          });
        return { output: entries.length > 0 ? entries.join("\n") : "(empty)", isError: false };
      },
    },

    // ── grep_codebase ────────────────────────────────────────
    {
      name: "grep_codebase",
      description: "Search for a pattern across all source files in the repo. Returns matching lines with file:line context.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Text or regex to search for" },
          file_glob: { type: "string", description: "Optional file pattern (e.g. '*.ts'). Default: all source files." },
        },
        required: ["pattern"],
      },
      async execute(input) {
        const pattern = String(input.pattern ?? "");
        const fileGlob = String(input.file_glob ?? "");
        if (!pattern) return { output: "No pattern provided", isError: true };

        try {
          const result = searchCodebase(repoRoot, pattern, fileGlob);
          if (!result) return { output: `No matches found for: ${pattern}`, isError: false };

          // Make paths relative
          const lines = result.split("\n").map((l) => l.replace(repoRoot + "/", "")).slice(0, 50);
          return { output: lines.join("\n"), isError: false };
        } catch {
          return { output: `No matches found for: ${pattern}`, isError: false };
        }
      },
    },

    // ── scan_repo_dna ────────────────────────────────────────
    {
      name: "scan_repo_dna",
      description: "Analyze the repo's code style, architecture, functions, and helpers. Returns a compact summary.",
      inputSchema: { type: "object", properties: {}, required: [] },
      async execute() {
        const dna = await extractDNA(repoRoot);
        const topHelpers = dna.helpers.slice(0, 8).map((h) => `${h.name} (${h.usages}x)`).join(", ");
        const pct = (c: number) => `${Math.round(c * 100)}%`;
        const output = [
          `Files: ${dna.files.length}`,
          `Functions: ${dna.functions.length} (avg ${dna.functionStats.avgFunctionSize} lines, ${dna.functionStats.asyncPercentage}% async)`,
          `Helpers: ${dna.helpers.length} cross-file utilities`,
          `Naming: ${dna.dominantNaming} (${pct(dna.namingConfidence)} of names — ${dna.namingConfidence < 0.7 ? "not a strict convention, mixed styles exist" : "consistent convention"})`,
          `Async style: ${dna.dominantAsyncStyle} (${pct(dna.asyncConfidence)} of files)`,
          `Error style: ${dna.dominantErrorStyle} (${pct(dna.errorConfidence)} of files)`,
          `Top helpers: ${topHelpers || "(none)"}`,
          `Architecture: routes=${dna.architecture.routes.length} services=${dna.architecture.services.length} repos=${dna.architecture.repositories.length}`,
        ].join("\n");
        return { output, isError: false };
      },
    },

    // ── run_tests ────────────────────────────────────────────
    {
      name: "run_tests",
      description: "Run the test suite. Returns PASS/FAIL and test output.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "Test command (default: npm test)" },
        },
      },
      async execute(input) {
        const command = String(input.command ?? "npm test");
        const result = runTests(repoRoot, command);
        return { output: `${result.passed ? "PASS" : "FAIL"}\n${result.output}`, isError: !result.passed };
      },
    },

    // ── fetch_github_issue ───────────────────────────────────
    {
      name: "fetch_github_issue",
      description: "Fetch a GitHub issue's title, body, labels, and comments by URL.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Full GitHub issue URL" },
        },
        required: ["url"],
      },
      async execute(input) {
        const { owner, repo, issueNumber } = parseIssueUrl(String(input.url));
        const issue = await fetchIssue(owner, repo, issueNumber);
        const commentSummary = issue.comments.length > 0
          ? issue.comments.slice(-3).map((c) => `  @${c.author}: ${c.body.slice(0, 200)}`).join("\n")
          : "  (no comments)";
        return {
          output: `#${issue.number}: ${issue.title}\nState: ${issue.state}\nLabels: ${issue.labels.join(", ") || "none"}\n\nBody:\n${issue.body}\n\nRecent comments:\n${commentSummary}`,
          isError: false,
        };
      },
    },

    // ── search_web ───────────────────────────────────────────
    {
      name: "search_web",
      description: "Search the web for information. Uses Brave Search (if BRAVE_SEARCH_API_KEY is set) or DuckDuckGo. Returns top results with titles, URLs, and snippets.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          count: { type: "number", description: "Number of results (default: 5, max: 10)" },
        },
        required: ["query"],
      },
      async execute(input) {
        const query = String(input.query ?? "");
        const count = Math.min(10, Math.max(1, Number(input.count ?? 5)));
        if (!query) return { output: "No query provided", isError: true };

        try {
          const results = await searchWeb(query, count);
          return { output: formatSearchResults(results), isError: false };
        } catch (err) {
          return { output: `Search failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
        }
      },
    },
  ];
}

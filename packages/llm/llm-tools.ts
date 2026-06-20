// packages/llm/llm-tools.ts
// Tool definitions available to the conversational agent.
// Each tool maps to a real action (read file, list dir, run tests, scan DNA, fetch issue).

import fs from "node:fs";
import path from "node:path";
import { extractDNA } from "../dna/extract.js";
import { runTests } from "../coding-agent/run-tests.js";
import type { ToolDefinition } from "../core/types.js";
import { parseIssueUrl } from "../context-agent/github/parse-issue-url.js";
import { fetchIssue } from "../context-agent/github/fetch-issue.js";

function safeResolvePath(repoRoot: string, relativePath: string): string {
  const resolved = path.resolve(repoRoot, relativePath);
  if (!resolved.startsWith(path.resolve(repoRoot))) {
    throw new Error("Path escapes the repository root");
  }
  return resolved;
}

/** Read .gitignore patterns to prevent the LLM from reading ignored files. */
function readGitignorePatterns(repoRoot: string): Set<string> {
  const gitignorePath = path.join(repoRoot, ".gitignore");
  if (!fs.existsSync(gitignorePath)) return new Set();
  const lines = fs.readFileSync(gitignorePath, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  return new Set(lines);
}

function isIgnored(relativePath: string, gitignorePatterns: Set<string>): boolean {
  const parts = relativePath.split(path.sep);
  for (const pattern of gitignorePatterns) {
    if (parts.some((p) => p === pattern)) return true;
    if (relativePath.includes(pattern)) return true;
  }
  return false;
}

export function createLLMTools(repoRoot: string): ToolDefinition[] {
  const gitignorePatterns = readGitignorePatterns(repoRoot);

  return [
    {
      name: "read_file",
      description: "Read a file from the repository. Path must be relative to repo root. Cannot read files listed in .gitignore.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file" },
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
        return { output: fs.readFileSync(absPath, "utf-8"), isError: false };
      },
    },

    {
      name: "list_directory",
      description: "List files and directories at a path relative to the repo root.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path relative to repo root" },
        },
      },
      async execute(input) {
        const dir = String(input.path ?? ".");
        const absPath = safeResolvePath(repoRoot, dir);
        if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
          return { output: `Directory not found: ${dir}`, isError: true };
        }
        const entries = fs.readdirSync(absPath)
          .filter((e) => !["node_modules", ".git", "dist", "build"].includes(e))
          .sort()
          .map((e) => {
            const full = path.join(absPath, e);
            return fs.statSync(full).isDirectory() ? `${e}/` : e;
          });
        return { output: entries.length > 0 ? entries.join("\n") : "(empty)", isError: false };
      },
    },

    {
      name: "scan_repo_dna",
      description: "Analyze the repository's code style, functions, helpers, and architecture. Returns a compact summary.",
      inputSchema: { type: "object", properties: {}, required: [] },
      async execute() {
        const dna = await extractDNA(repoRoot);
        const topHelpers = dna.helpers.slice(0, 8).map((h) => `${h.name} (${h.usages}x)`).join(", ");
        const output = [
          `Files: ${dna.files.length}`,
          `Functions: ${dna.functions.length} (avg ${dna.functionStats.avgFunctionSize} lines, ${dna.functionStats.asyncPercentage}% async)`,
          `Helpers: ${dna.helpers.length} cross-file utilities`,
          `Naming: ${dna.dominantNaming}`,
          `Async style: ${dna.dominantAsyncStyle}`,
          `Error style: ${dna.dominantErrorStyle}`,
          `Top helpers: ${topHelpers || "(none)"}`,
          `Architecture: routes=${dna.architecture.routes.length} services=${dna.architecture.services.length} repos=${dna.architecture.repositories.length}`,
        ].join("\n");
        return { output, isError: false };
      },
    },

    {
      name: "run_tests",
      description: "Run the test suite and return pass/fail with output.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "Test command to run (default: npm test)" },
        },
      },
      async execute(input) {
        const command = String(input.command ?? "npm test");
        const result = runTests(repoRoot, command);
        return { output: `${result.passed ? "PASS" : "FAIL"}\n${result.output}`, isError: !result.passed };
      },
    },

    {
      name: "fetch_github_issue",
      description: "Fetch a GitHub issue's title, body, and comments by URL.",
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
        return {
          output: `Title: ${issue.title}\n\nBody:\n${issue.body}\n\nComments: ${issue.comments.length}`,
          isError: false,
        };
      },
    },
  ];
}
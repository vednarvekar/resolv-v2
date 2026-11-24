import type { ToolDefinition } from "../../core/types.js";
import { extractDNA } from "../../dna/extract.js";
import { runTests } from "../../coding-agent/run-tests.js";
import { execSync } from "node:child_process";

export function createRepoTools(repoRoot: string, configuredTestCommand: string): ToolDefinition[] {
  return [
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
    {
      // GUARDRAIL: the test command is fixed to what the user configured
      // (config.testCommand), never to a string the model supplies. Issue
      // bodies/comments are untrusted input that flows into the model's
      // context — if the model could pick the shell command to run here,
      // a poisoned GitHub issue could get arbitrary shell execution via
      // execSync. The tool schema below intentionally exposes no
      // "command" parameter to the model.
      name: "run_tests",
      description: "Run the repo's configured test suite. Returns PASS/FAIL and test output.",
      inputSchema: { type: "object", properties: {}, required: [] },
      async execute() {
        const result = runTests(repoRoot, configuredTestCommand);
        return { output: `${result.passed ? "PASS" : "FAIL"}\n${result.output}`, isError: !result.passed };
      },
    },
    {
      name: "git_status",
      description: "Show git working tree status (branch, staged/unstaged, untracked files).",
      inputSchema: { type: "object", properties: {}, required: [] },
      async execute() {
        try {
          const output = execSync("git status --short --branch", {
            cwd: repoRoot,
            encoding: "utf-8",
            stdio: "pipe",
          }).trim();
          return { output: output || "Working tree clean", isError: false };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { output: `git status failed: ${message}`, isError: true };
        }
      },
    },
    {
      name: "git_diff",
      description: "Show git diff for working tree changes. Set staged=true to see staged diff.",
      inputSchema: {
        type: "object",
        properties: {
          staged: { type: "boolean", description: "If true, show staged diff instead of unstaged diff" },
        },
      },
      async execute(input) {
        const staged = Boolean(input.staged);
        try {
          const cmd = staged ? "git diff --staged --" : "git diff --";
          const output = execSync(cmd, {
            cwd: repoRoot,
            encoding: "utf-8",
            stdio: "pipe",
            maxBuffer: 1024 * 1024 * 4,
          }).trim();
          return { output: output || "No diff", isError: false };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { output: `git diff failed: ${message}`, isError: true };
        }
      },
    },
    {
      name: "git_branches",
      description: "List local branches and indicate current branch.",
      inputSchema: { type: "object", properties: {}, required: [] },
      async execute() {
        try {
          const output = execSync("git branch --list", {
            cwd: repoRoot,
            encoding: "utf-8",
            stdio: "pipe",
          }).trim();
          return { output: output || "No branches found", isError: false };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { output: `git branch failed: ${message}`, isError: true };
        }
      },
    },
  ];
}

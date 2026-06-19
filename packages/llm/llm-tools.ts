import fs from "node:fs";
import path from "node:path";
import { extractDNA } from "../dna/extract.js";
import { runTests } from "../coding-agent/run-tests.js";
import type { ToolDefinition } from "../core/types.js";

function normalizeRepoPath(repoRoot: string, relativePath: string): string {
  const resolved = path.resolve(repoRoot, relativePath);
  if (!resolved.startsWith(path.resolve(repoRoot))) {
    throw new Error("Path escapes the repository root");
  }
  return resolved;
}

function prettyList(items: string[]): string {
  return items.length === 0 ? "(empty)" : items.map((item) => `- ${item}`).join("\n");
}

export function createLLMTools(repoRoot: string): ToolDefinition[] {
  return [
    {
      name: "read_file",
      description: "Read a file from the repository. Use a path relative to the repo root.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to the repo root" },
        },
        required: ["path"],
      },
      async execute(input) {
        const filePath = String(input.path ?? "");
        const absPath = normalizeRepoPath(repoRoot, filePath);
        if (!fs.existsSync(absPath)) {
          return { output: `File not found: ${filePath}`, isError: true };
        }
        const content = fs.readFileSync(absPath, "utf-8");
        return { output: content, isError: false };
      },
    },
    {
      name: "list_directory",
      description: "List the contents of a directory in the repository. Use a path relative to the repo root.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path relative to the repo root" },
        },
      },
      async execute(input) {
        const directory = String(input.path ?? ".");
        const absPath = normalizeRepoPath(repoRoot, directory);
        if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
          return { output: `Directory not found: ${directory}`, isError: true };
        }
        const entries = fs.readdirSync(absPath).sort();
        return { output: prettyList(entries), isError: false };
      },
    },
    {
      name: "scan_repo_dna",
      description: "Analyze the repository and return a summary of its style, files, and architecture.",
      inputSchema: { type: "object", properties: {}, required: [] },
      async execute() {
        const dna = await extractDNA(repoRoot);
        const errorStyles = dna.errorPatterns.map((p) => p.style).join(", ") || "none";
        const asyncStyles = dna.asyncPatterns.map((p) => p.dominantStyle).join(", ") || "none";
        const topHelpers = dna.helpers.slice(0, 10).map((h) => `${h.name} (${h.usages}x)`).join(", ") || "none";
        const output = [
          `Repo root: ${dna.repoRoot}`,
          `Files: ${dna.files.length}`,
          `Functions: ${dna.functions.length}`,
          `Helpers: ${dna.helpers.length}`,
          `Naming: ${dna.naming.dominantStyle}`,
          `Error styles: ${errorStyles}`,
          `Async styles: ${asyncStyles}`,
          `Top helpers: ${topHelpers}`,
        ].join("\n");
        return { output, isError: false };
      },
    },
    {
      name: "run_tests",
      description: "Run the repository test command from the repo root and return the result output.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "Command to run in the repo root, e.g. npm test" },
        },
      },
      async execute(input) {
        const command = String(input.command ?? "npm test");
        try {
          const result = runTests(repoRoot, command);
          const summary = result.passed ? "PASS" : "FAIL";
          return { output: `${summary}\n${result.output}`, isError: !result.passed };
        } catch (error) {
          return { output: error instanceof Error ? error.message : String(error), isError: true };
        }
      },
    },
  ];
}

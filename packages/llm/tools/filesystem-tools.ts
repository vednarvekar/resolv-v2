import fs from "node:fs";
import path from "node:path";

import type { ToolDefinition } from "../../core/types.js";
import { ALWAYS_SKIP, isIgnored, isProtectedPath, safeResolvePath, searchCodebase } from "./tool-utils.js";

// GUARDRAIL: hard cap on a single write, independent of .gitignore. This
// bounds worst-case damage from a runaway/looping model turn and keeps a
// single tool call from dumping something absurd (e.g. a base64 blob) into
// the repo.
const MAX_WRITE_BYTES = 200_000;

export function createFilesystemTools(
  repoRoot: string,
  gitignorePatterns: Set<string>,
): ToolDefinition[] {
  return [
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
        const content = fs.readFileSync(absPath, "utf-8");
        const MAX = 20_000;
        if (content.length > MAX) {
          return { output: content.slice(0, MAX) + `\n\n...(truncated at ${MAX} chars, file is ${content.length} chars total)`, isError: false };
        }
        return { output: content, isError: false };
      },
    },
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

        // GUARDRAIL: secrets, git internals, CI config, and lockfiles are
        // off-limits regardless of what the model or the issue text asks
        // for. This is checked before the .gitignore check on purpose —
        // a repo without a .gitignore entry for .env would otherwise be
        // writable.
        if (isProtectedPath(filePath)) {
          return { output: `Refusing to write to a protected path: ${filePath}`, isError: true };
        }
        if (isIgnored(filePath, gitignorePatterns)) {
          return { output: `Refusing to write to a .gitignore path: ${filePath}`, isError: true };
        }
        if (Buffer.byteLength(content, "utf-8") > MAX_WRITE_BYTES) {
          return {
            output: `Refusing write: content is ${Buffer.byteLength(content, "utf-8")} bytes, over the ${MAX_WRITE_BYTES}-byte limit for a single write_file call. Split the change into smaller edits.`,
            isError: true,
          };
        }

        const absPath = safeResolvePath(repoRoot, filePath);
        const previous = fs.existsSync(absPath) ? fs.readFileSync(absPath, "utf-8") : "";
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, content, "utf-8");
        return { output: formatWriteDiff(filePath, previous, content), isError: false };
      },
    },
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

          const lines = result.split("\n").map((l) => l.replace(repoRoot + "/", "")).slice(0, 50);
          return { output: lines.join("\n"), isError: false };
        } catch {
          return { output: `No matches found for: ${pattern}`, isError: false };
        }
      },
    },
  ];
}

function formatWriteDiff(filePath: string, before: string, after: string): string {
  if (before === after) {
    return `Written: ${filePath} (no content change)`;
  }

  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  let start = 0;
  while (start < beforeLines.length && start < afterLines.length && beforeLines[start] === afterLines[start]) start++;

  let beforeEnd = beforeLines.length;
  let afterEnd = afterLines.length;
  while (beforeEnd > start && afterEnd > start && beforeLines[beforeEnd - 1] === afterLines[afterEnd - 1]) {
    beforeEnd--;
    afterEnd--;
  }

  const removed = beforeLines.slice(start, beforeEnd);
  const added = afterLines.slice(start, afterEnd);
  const lines = [`Updated: ${filePath}`];

  for (const line of removed) {
    lines.push(`- ${line}`);
  }
  for (const line of added) {
    lines.push(`+ ${line}`);
  }

  return lines.join("\n");
}

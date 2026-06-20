// packages/dna/analysis/files.ts
// Scans the repo for source files. Returns compact RepoFile objects —
// absolutePath excluded from output to keep DNA JSON portable.

import fs from "node:fs";
import path from "node:path";
import type { Language, RepoFile } from "../types.js";

const ALWAYS_IGNORE = [
  "node_modules", ".git", "dist", "build", ".next",
  "__pycache__", ".venv", "venv", "coverage", ".nyc_output",
  ".turbo", ".cache", "tmp", "temp",
];

const EXT_MAP: Record<string, Language> = {
  ".ts": "typescript", ".tsx": "typescript",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python",
};

function matchesGitignore(name: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // simple name match and glob-less pattern match
    if (pattern === name) return true;
    if (pattern.endsWith("/") && pattern.slice(0, -1) === name) return true;
    if (pattern.startsWith("*") && name.endsWith(pattern.slice(1))) return true;
  }
  return false;
}

export function scanFiles(repoRoot: string, gitignorePatterns: string[] = []): RepoFile[] {
  const results: RepoFile[] = [];

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (ALWAYS_IGNORE.includes(entry.name)) continue;
      if (matchesGitignore(entry.name, gitignorePatterns)) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        const ext = path.extname(entry.name);
        const lang = EXT_MAP[ext];
        if (!lang || lang === "unknown") continue;

        let lineCount = 0;
        try {
          lineCount = fs.readFileSync(fullPath, "utf-8").split("\n").length;
        } catch {
          continue;
        }

        results.push({
          relativePath: path.relative(repoRoot, fullPath),
          language: lang,
          lineCount,
        });
      }
    }
  }

  walk(repoRoot);
  return results;
}
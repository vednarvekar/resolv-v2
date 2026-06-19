import fs from "node:fs";
import path from "node:path";
import type { Language, RepoFile } from "../types.js";

const IGNORE = [
  "node_modules", ".git", "dist", "build", ".next",
  "__pycache__", ".venv", "venv", "coverage", ".nyc_output",
];

const EXT_MAP: Record<string, Language> = {
  ".ts": "typescript", ".tsx": "typescript",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python",
};

function detectLanguage(ext: string): Language {
  return EXT_MAP[ext] ?? "unknown";
}

function countLines(filePath: string): number {
  const content = fs.readFileSync(filePath, "utf-8");
  return content.split("\n").length;
}

export function scanFiles(repoPath: string): RepoFile[] {
  const results: RepoFile[] = [];

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (IGNORE.includes(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        const ext = path.extname(entry.name);
        const lang = detectLanguage(ext);
        if (lang === "unknown") continue;

        let stat: fs.Stats;
        try {
          stat = fs.statSync(fullPath);
        } catch {
          continue;
        }

        results.push({
          absolutePath: fullPath,
          relativePath: path.relative(repoPath, fullPath),
          extension: ext,
          language: lang,
          sizeBytes: stat.size,
          lineCount: countLines(fullPath),
        });
      }
    }
  }

  walk(repoPath);
  return results;
}

export function getLanguageBreakdown(files: RepoFile[]): Record<Language, number> {
  const breakdown: Record<Language, number> = {
    typescript: 0, javascript: 0, python: 0, unknown: 0,
  };
  for (const file of files) breakdown[file.language]++;
  return breakdown;
}

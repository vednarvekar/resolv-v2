// packages/dna/analysis/dependencies.ts
// Reads package.json and cross-references with source imports to find usage counts.
// Does NOT store the full import map per-file — that was the #1 source of JSON bloat.

import fs from "node:fs";
import path from "node:path";
import type { DependencyInfo } from "../types.js";

function rootPackageName(source: string): string {
  if (source.startsWith("@")) return source.split("/").slice(0, 2).join("/");
  return source.split("/")[0] ?? source;
}

export function analyzeDependencies(repoRoot: string): DependencyInfo[] {
  const pkgPath = path.join(repoRoot, "package.json");
  if (!fs.existsSync(pkgPath)) return [];

  let deps: Record<string, string> = {};
  let devDeps: Record<string, string> = {};
  try {
    const raw = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    deps = raw.dependencies ?? {};
    devDeps = raw.devDependencies ?? {};
  } catch {
    return [];
  }

  const allDeps = { ...deps, ...devDeps };
  const usageCounts = new Map<string, number>(Object.keys(allDeps).map((k) => [k, 0]));

  // Walk source files and count imports — no per-file storage
  function countImportsInFile(filePath: string) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const importRegex = /(?:import|require)\s*\(?['"]([^'"]+)['"]\)?/g;
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(content)) !== null) {
        const source = match[1];
        if (!source) continue;
        if (source.startsWith(".") || source.startsWith("/")) continue;
        const pkg = rootPackageName(source);
        if (usageCounts.has(pkg)) {
          usageCounts.set(pkg, (usageCounts.get(pkg) ?? 0) + 1);
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  function walk(dir: string) {
    const SKIP = ["node_modules", "dist", "build", ".git"];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP.includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|jsx|mjs|cjs|py)$/.test(entry.name)) countImportsInFile(full);
    }
  }

  walk(repoRoot);

  return Object.entries(allDeps)
    .map(([name, version]) => ({
      name,
      version,
      isDev: name in devDeps,
      usageCount: usageCounts.get(name) ?? 0,
    }))
    .sort((a, b) => b.usageCount - a.usageCount);
}
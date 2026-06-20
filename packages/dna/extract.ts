// packages/dna/extract.ts
// Single entry point for repo DNA extraction.
// Builds ONE ts-morph Project and reuses it across every analyzer.
// Output is intentionally compact — see types.ts for design rationale.

import { Project } from "ts-morph";
import fs from "node:fs";
import path from "node:path";

import { scanFiles } from "./analysis/files.js";
import { analyzeExports } from "./analysis/exports.js";
import { analyzeFunctions } from "./analysis/functions.js";
import { analyzeHelpers } from "./analysis/helpers.js";
import { analyzeArchitecture } from "./analysis/architecture.js";
import { analyzeErrors } from "./analysis/errors.js";
import { analyzePatterns } from "./analysis/patterns.js";
import { analyzeDependencies } from "./analysis/dependencies.js";

import type { DNAProfile, NamingStyle } from "./types.js";

/** Read .gitignore and return patterns to skip during scan. */
function readGitignorePatterns(repoRoot: string): string[] {
  const gitignorePath = path.join(repoRoot, ".gitignore");
  if (!fs.existsSync(gitignorePath)) return [];
  return fs
    .readFileSync(gitignorePath, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

/** Detect dominant naming style from function/export names — no per-identifier counting. */
function detectNamingStyle(names: string[]): NamingStyle {
  let camel = 0, snake = 0, pascal = 0;
  for (const n of names) {
    if (/^[a-z][a-zA-Z0-9]*$/.test(n) && /[A-Z]/.test(n)) camel++;
    else if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(n)) snake++;
    else if (/^[A-Z][a-zA-Z0-9]+$/.test(n)) pascal++;
  }
  const total = camel + snake + pascal;
  if (total === 0) return "camelCase";
  if (camel / total > 0.5) return "camelCase";
  if (snake / total > 0.5) return "snake_case";
  if (pascal / total > 0.5) return "PascalCase";
  return "mixed";
}

function mostCommon<T extends string>(values: T[]): T | undefined {
  if (!values.length) return undefined;
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export async function extractDNA(repoRoot: string): Promise<DNAProfile> {
  const gitignorePatterns = readGitignorePatterns(repoRoot);
  const files = scanFiles(repoRoot, gitignorePatterns);

  const project = new Project({ skipFileDependencyResolution: true });
  project.addSourceFilesAtPaths([
    `${repoRoot}/**/*.ts`,
    `${repoRoot}/**/*.tsx`,
    `${repoRoot}/**/*.js`,
    `${repoRoot}/**/*.jsx`,
    `!${repoRoot}/**/node_modules/**`,
    `!${repoRoot}/**/dist/**`,
    `!${repoRoot}/**/build/**`,
    `!${repoRoot}/**/*.d.ts`,
  ]);

  const exportsData = analyzeExports(project, repoRoot);
  const functionAnalysis = analyzeFunctions(project);
  const helpers = analyzeHelpers(project);
  const architecture = analyzeArchitecture(project);
  const errorPatterns = analyzeErrors(project);
  const asyncPatterns = analyzePatterns(project);
  const dependencies = analyzeDependencies(repoRoot);

  // Derive dominant styles from aggregated data (one label each, not per-file arrays)
  const allFunctionNames = functionAnalysis.functions.map((f) => f.name).filter((n) => n !== "anonymous");
  const dominantNaming = detectNamingStyle(allFunctionNames);
  const dominantAsyncStyle = mostCommon(asyncPatterns.map((p) => p.dominantStyle)) ?? "async-await";
  const dominantErrorStyle = mostCommon(errorPatterns.map((e) => e.style)) ?? "try-catch";

  return {
    repoRoot,
    scannedAt: new Date().toISOString(),
    files,
    exports: exportsData,
    functions: functionAnalysis.functions,
    functionStats: functionAnalysis.stats,
    helpers,
    architecture,
    dominantNaming,
    dominantAsyncStyle,
    dominantErrorStyle,
    dependencies,
  };
}
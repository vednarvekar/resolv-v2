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

/** Detect dominant naming style from function/export names — no per-identifier counting.
 *  Returns both the label and how dominant it is, since a 55/45 split and a
 *  95/5 split are very different signals for "should I match this style strictly." */
function detectNamingStyle(names: string[]): { style: NamingStyle; confidence: number } {
  let camel = 0;
  let snake = 0;
  let pascal = 0;

  for (const name of names) {
    if (/^[a-z][a-zA-Z0-9]*$/.test(name) && /[A-Z]/.test(name)) {
      camel++;
    } else if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(name)) {
      snake++;
    } else if (/^[A-Z][a-zA-Z0-9]+$/.test(name)) {
      pascal++;
    }
  }

  const total = camel + snake + pascal;
  if (total === 0) return { style: "camelCase", confidence: 0 };

  const top = Math.max(camel, snake, pascal);
  const ratio = top / total;
  if (ratio <= 0.5) return { style: "mixed", confidence: ratio };
  if (top === camel) return { style: "camelCase", confidence: ratio };
  if (top === snake) return { style: "snake_case", confidence: ratio };
  return { style: "PascalCase", confidence: ratio };
}

function dominantWithConfidence<T extends string>(values: T[]): { value: T | undefined; confidence: number } {
  if (!values.length) return { value: undefined, confidence: 0 };

  const counts = new Map<T, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const [value, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
  return { value, confidence: count / values.length };
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

  // Derive dominant styles from aggregated data (one label + confidence each, not per-file arrays)
  const allFunctionNames = functionAnalysis.functions.map((f) => f.name).filter((n) => n !== "anonymous");
  const naming = detectNamingStyle(allFunctionNames);
  const asyncResult = dominantWithConfidence(asyncPatterns.map((p) => p.dominantStyle));
  const errorResult = dominantWithConfidence(errorPatterns.map((e) => e.style));

  return {
    repoRoot,
    scannedAt: new Date().toISOString(),
    files,
    exports: exportsData,
    functions: functionAnalysis.functions,
    functionStats: functionAnalysis.stats,
    helpers,
    architecture,
    dominantNaming: naming.style,
    namingConfidence: naming.confidence,
    dominantAsyncStyle: asyncResult.value ?? "async-await",
    asyncConfidence: asyncResult.confidence,
    dominantErrorStyle: errorResult.value ?? "try-catch",
    errorConfidence: errorResult.confidence,
    dependencies,
  };
}

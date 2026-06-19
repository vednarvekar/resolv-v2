import { Project } from "ts-morph";

import { scanFiles } from "./analysis/files.js";
import { analyzeImports } from "./analysis/imports.js";
import { analyzeExports } from "./analysis/exports.js";
import { analyzeFunctions } from "./analysis/functions.js";
import { analyzeHelpers } from "./analysis/helpers.js";
import { analyzeCallGraph } from "./analysis/callgraph.js";
import { analyzeArchitecture } from "./analysis/architecture.js";
import { analyzeNaming } from "./analysis/naming.js";
import { analyzeErrors } from "./analysis/errors.js";
import { analyzePatterns } from "./analysis/patterns.js";
import { analyzeDependencies } from "./analysis/dependencies.js";
import { analyzeStructure } from "./analysis/structure.js";

import type { DNAProfile } from "./types.js";

/**
 * Single entry point for repo DNA extraction.
 * Builds ONE ts-morph Project and reuses it across every JS/TS analyzer,
 * so the repo's source is parsed once, not once-per-module.
 */
export async function extractDNA(repoPath: string): Promise<DNAProfile> {
  const files = scanFiles(repoPath);

  const project = new Project({ skipFileDependencyResolution: true });
  project.addSourceFilesAtPaths([
    `${repoPath}/**/*.ts`,
    `${repoPath}/**/*.tsx`,
    `${repoPath}/**/*.js`,
    `${repoPath}/**/*.jsx`,
    `!${repoPath}/**/node_modules/**`,
    `!${repoPath}/**/dist/**`,
    `!${repoPath}/**/build/**`,
  ]);

  // --- DEBUG CHECK: Let's see what files ts-morph actually grabbed ---
  const sourceFiles = project.getSourceFiles();
  console.log(`\nFound ${sourceFiles.length} files in AST project.`);
  
  // Helper to run analyzers safely and catch where the type checker breaks
  const runSafe = (name: string, fn: () => any) => {
    try {
      console.log(`⏳ Running ${name}...`);
      return fn();
    } catch (err) {
      console.error(`\n❌ CRASHED INSIDE ANALYZER: ${name}`);
      throw err;
    }
  };

  const imports = runSafe("analyzeImports", () => analyzeImports(files, project, repoPath));
  const exportsData = runSafe("analyzeExports", () => analyzeExports(files, project, repoPath));
  const functionAnalysis = runSafe("analyzeFunctions", () => analyzeFunctions(project));
  const helpers = runSafe("analyzeHelpers", () => analyzeHelpers(project));
  const callGraph = runSafe("analyzeCallGraph", () => analyzeCallGraph(project));
  const architecture = runSafe("analyzeArchitecture", () => analyzeArchitecture(project));
  const naming = runSafe("analyzeNaming", () => analyzeNaming(project));
  const errorPatterns = runSafe("analyzeErrors", () => analyzeErrors(project));
  const asyncPatterns = runSafe("analyzePatterns", () => analyzePatterns(project));
  const dependencies = runSafe("analyzeDependencies", () => analyzeDependencies(imports, repoPath));
  const structure = runSafe("analyzeStructure", () => analyzeStructure(repoPath));
  // -------------------------------------------------------------------

  return {
    repoRoot: repoPath,
    scannedAt: new Date().toISOString(),
    files,
    imports,
    exports: exportsData,
    functions: functionAnalysis.functions,
    functionStats: functionAnalysis.stats,
    helpers,
    callGraph,
    architecture,
    naming,
    errorPatterns,
    asyncPatterns,
    dependencies,
    structure,
  };
}
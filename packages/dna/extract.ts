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

  const imports = analyzeImports(files, project, repoPath);
  const exportsData = analyzeExports(files, project, repoPath);
  const functionAnalysis = analyzeFunctions(project);
  const helpers = analyzeHelpers(project);
  const callGraph = analyzeCallGraph(project);
  const architecture = analyzeArchitecture(project);
  const naming = analyzeNaming(project);
  const errorPatterns = analyzeErrors(project);
  const asyncPatterns = analyzePatterns(project);
  const dependencies = analyzeDependencies(imports, repoPath);
  const structure = analyzeStructure(repoPath);

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

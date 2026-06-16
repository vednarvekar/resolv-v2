import { Project } from "ts-morph";

import { scanFiles } from "./analysis/files.js";
import { analyzeImports } from "./analysis/imports.js";
import { analyzeExports } from "./analysis/exports.js";
import { analyzeFunctions } from "./analysis/functions.js";
import { analyzeHelpers } from "./analysis/helpers.js";
import { analyzeCallGraph } from "./analysis/callgraph.js";
import { analyzeArchitecture } from "./analysis/architecture.js";

export async function extractDNA(repoPath: string) {
  const files = scanFiles(repoPath);

  const project = new Project({
    skipFileDependencyResolution: true
  });

  project.addSourceFilesAtPaths([
    `${repoPath}/**/*.ts`,
    `${repoPath}/**/*.tsx`,
    `${repoPath}/**/*.js`,
    `${repoPath}/**/*.jsx`
  ]);

  const imports = analyzeImports(files, repoPath);
  const exportsData = analyzeExports(files);
  const functionAnalysis = analyzeFunctions(project);
  const helpers = analyzeHelpers(project);
  const callGraph = analyzeCallGraph(project);
  const architecture = analyzeArchitecture(project);

  return {
    files,
    imports,
    exports: exportsData,
    functions: functionAnalysis.functions,
    helpers,
    callGraph,
    architecture
  };
}
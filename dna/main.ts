// import path from "path";
// import { scanFiles, getLanguageBreakdown } from "./analysis/files.js";
// import { analyzeImports } from "./analysis/imports.js";

// // const repoPath = process.argv[2] || ".";
// // const files = scanFiles(repoPath);
// // console.log(`Total files: ${files.length}`);


// const repoPath = process.argv[2] || ".";
// const resolvedPath = path.resolve(repoPath);

// console.log(`Scanning targets inside: ${resolvedPath}`);
// const files = scanFiles(resolvedPath);
// const importsProfile = analyzeImports(files, resolvedPath);

// console.log(`\n--- Files Scan ---`);
// console.log(`Total codebase files: ${files.length}`);
// console.log(getLanguageBreakdown(files));

// console.log(`\n--- Top 5 Most Used Dependencies/Imports ---`);
// const sortedImports = Object.entries(importsProfile.importFrequency)
//   .sort((a, b) => b[1] - a[1])
//   .slice(0, 5);
// console.log(Object.fromEntries(sortedImports));

// console.log(`\n--- External Dependencies Detected ---`);
// console.log(importsProfile.uniqueExternalDependencies);


import { Project } from "ts-morph";

import { scanFiles } from "./analysis/files.js";
import { analyzeImports } from "./analysis/imports.js";
import { analyzeExports } from "./analysis/exports.js";
import { analyzeFunctions } from "./analysis/functions.js";
import { analyzeHelpers } from "./analysis/helpers.js"
import { analyzeCallGraph } from "./analysis/callgraph.js";

export async function extractDNA(
  repoPath: string
) {

  const files = scanFiles(repoPath);

  const project = new Project();

  project.addSourceFilesAtPaths(
    `${repoPath}/**/*.{ts,tsx,js,jsx}`
  );

  const imports =
    analyzeImports(files, repoPath);

  const exportsData =
    analyzeExports(files);

  const functions =
    analyzeFunctions(project);

  const helpers =
    analyzeHelpers(project);

  const callGraph =
    analyzeCallGraph(project);

  return {
    files,
    imports,
    exports: exportsData,
    functions,
    helpers,
    callGraph
  };
}
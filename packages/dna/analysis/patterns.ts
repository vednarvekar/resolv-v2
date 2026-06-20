// packages/dna/analysis/patterns.ts
// Detects async style per file — dominant label only, no raw counts.

import { Project, SyntaxKind } from "ts-morph";
import type { AsyncPattern } from "../types.js";

export function analyzePatterns(project: Project): AsyncPattern[] {
  const results: AsyncPattern[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (filePath.includes("node_modules") || filePath.endsWith(".d.ts")) continue;

    const asyncAwait = sourceFile.getDescendantsOfKind(SyntaxKind.AwaitExpression).length;
    let promiseChain = 0;
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpressionIfKind(SyntaxKind.PropertyAccessExpression);
      if (expr?.getName() === "then") promiseChain++;
    }

    if (asyncAwait === 0 && promiseChain === 0) continue;

    const total = asyncAwait + promiseChain;
    let dominantStyle: AsyncPattern["dominantStyle"];
    if (asyncAwait / total > 0.6) dominantStyle = "async-await";
    else if (promiseChain / total > 0.6) dominantStyle = "promise-chain";
    else dominantStyle = "mixed";

    results.push({ file: filePath, dominantStyle });
  }

  return results;
}
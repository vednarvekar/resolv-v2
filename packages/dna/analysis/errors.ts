// packages/dna/analysis/errors.ts
// Detects dominant error handling style per file.
// Returns one label per file — no raw counts, no custom exception name arrays.

import { Project, SyntaxKind } from "ts-morph";
import type { ErrorPattern } from "../types.js";

export function analyzeErrors(project: Project): ErrorPattern[] {
  const results: ErrorPattern[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (filePath.includes("node_modules") || filePath.endsWith(".d.ts")) continue;

    const tryCatch = sourceFile.getDescendantsOfKind(SyntaxKind.TryStatement).length;

    let promiseCatch = 0;
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpressionIfKind(SyntaxKind.PropertyAccessExpression);
      if (expr?.getName() === "catch") promiseCatch++;
    }

    if (tryCatch === 0 && promiseCatch === 0) continue;

    const style: ErrorPattern["style"] = tryCatch >= promiseCatch ? "try-catch" : "promise-catch";
    results.push({ file: filePath, style });
  }

  return results;
}
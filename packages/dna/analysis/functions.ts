// packages/dna/analysis/functions.ts
// Extracts named functions and methods only.
// Anonymous arrow functions are excluded — they add hundreds of entries
// and carry no useful signal for the planner or prompt builder.

import { Project, SyntaxKind } from "ts-morph";
import path from "node:path";
import type { FunctionInfo, FunctionStats } from "../types.js";

export interface FunctionAnalysis {
  functions: FunctionInfo[];
  stats: FunctionStats;
}

export function analyzeFunctions(project: Project): FunctionAnalysis {
  const functions: FunctionInfo[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (filePath.includes("node_modules") || filePath.endsWith(".d.ts")) continue;

    // Named function declarations only
    for (const fn of sourceFile.getFunctions()) {
      const name = fn.getName();
      if (!name) continue; // skip anonymous
      functions.push({
        name,
        kind: "function",
        params: fn.getParameters().map((p) => p.getName()),
        async: fn.isAsync(),
        lines: fn.getEndLineNumber() - fn.getStartLineNumber() + 1,
        file: path.relative(project.getRootDirectories()[0]?.getPath() ?? "", filePath),
      });
    }

    // Class methods
    for (const method of sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration)) {
      functions.push({
        name: method.getName(),
        kind: "method",
        params: method.getParameters().map((p) => p.getName()),
        async: method.isAsync(),
        lines: method.getEndLineNumber() - method.getStartLineNumber() + 1,
        file: path.relative(project.getRootDirectories()[0]?.getPath() ?? "", filePath),
      });
    }
  }

  const totalLines = functions.reduce((s, f) => s + f.lines, 0);
  const asyncCount = functions.filter((f) => f.async).length;

  return {
    functions,
    stats: {
      totalFunctions: functions.length,
      avgFunctionSize: functions.length > 0 ? Math.round(totalLines / functions.length) : 0,
      asyncPercentage: functions.length > 0 ? Math.round((asyncCount / functions.length) * 100) : 0,
    },
  };
}
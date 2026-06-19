import { Project, SyntaxKind } from "ts-morph";
import type { FunctionInfo, FunctionAnalysis } from "../types.js";

export function analyzeFunctions(project: Project): FunctionAnalysis {
  const functions: FunctionInfo[] = [];
  const paramCounts = new Map<string, number>();

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (filePath.includes("node_modules") || filePath.endsWith(".d.ts")) continue;

    for (const fn of sourceFile.getFunctions()) {
      collectFunction(
        functions, paramCounts,
        fn.getName() || "anonymous", "function",
        fn.getParameters().map((p) => p.getName()),
        fn.isAsync(), fn.getStartLineNumber(), fn.getEndLineNumber(), filePath
      );
    }

    for (const method of sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration)) {
      collectFunction(
        functions, paramCounts,
        method.getName(), "method",
        method.getParameters().map((p) => p.getName()),
        method.isAsync(), method.getStartLineNumber(), method.getEndLineNumber(), filePath
      );
    }

    for (const arrow of sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction)) {
      collectFunction(
        functions, paramCounts,
        "anonymous-arrow", "arrow",
        arrow.getParameters().map((p) => p.getName()),
        arrow.isAsync(), arrow.getStartLineNumber(), arrow.getEndLineNumber(), filePath
      );
    }
  }

  const totalLines = functions.reduce((sum, fn) => sum + fn.lines, 0);
  const asyncCount = functions.filter((fn) => fn.async).length;
  const commonParamNames = [...paramCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name]) => name);

  return {
    functions,
    stats: {
      totalFunctions: functions.length,
      avgFunctionSize: functions.length > 0 ? Math.round(totalLines / functions.length) : 0,
      asyncPercentage: functions.length > 0 ? Math.round((asyncCount / functions.length) * 100) : 0,
      commonParamNames,
    },
  };
}

function collectFunction(
  functions: FunctionInfo[],
  paramCounts: Map<string, number>,
  name: string,
  kind: FunctionInfo["kind"],
  params: string[],
  isAsync: boolean,
  startLine: number,
  endLine: number,
  file: string
) {
  params.forEach((param) => {
    paramCounts.set(param, (paramCounts.get(param) || 0) + 1);
  });

  functions.push({ name, kind, params, async: isAsync, lines: endLine - startLine + 1, file });
}

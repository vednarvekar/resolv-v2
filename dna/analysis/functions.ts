import { Project, SyntaxKind } from "ts-morph";

export interface FunctionInfo {
  name: string;
  kind: "function" | "method" | "arrow";
  params: string[];
  async: boolean;
  lines: number;
  file: string;
}

export interface FunctionAnalysis {
  functions: FunctionInfo[];
  stats: {
    totalFunctions: number;
    avgFunctionSize: number;
    asyncPercentage: number;
    commonParamNames: string[];
  };
}

export function analyzeFunctions(
  project: Project
): FunctionAnalysis {
  const functions: FunctionInfo[] = [];
  const paramCounts = new Map<string, number>();

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();

    // Standard functions
    for (const fn of sourceFile.getFunctions()) {
      collectFunction(
        functions,
        paramCounts,
        fn.getName() || "anonymous",
        "function",
        fn.getParameters().map((p) => p.getName()),
        fn.isAsync(),
        fn.getStartLineNumber(),
        fn.getEndLineNumber(),
        filePath
      );
    }

    // Class methods
    for (const method of sourceFile.getDescendantsOfKind(
      SyntaxKind.MethodDeclaration
    )) {
      collectFunction(
        functions,
        paramCounts,
        method.getName(),
        "method",
        method.getParameters().map((p) => p.getName()),
        method.isAsync(),
        method.getStartLineNumber(),
        method.getEndLineNumber(),
        filePath
      );
    }

    // Arrow functions
    for (const arrow of sourceFile.getDescendantsOfKind(
      SyntaxKind.ArrowFunction
    )) {
      collectFunction(
        functions,
        paramCounts,
        "anonymous-arrow",
        "arrow",
        arrow.getParameters().map((p) => p.getName()),
        arrow.isAsync(),
        arrow.getStartLineNumber(),
        arrow.getEndLineNumber(),
        filePath
      );
    }
  }

  const totalLines = functions.reduce(
    (sum, fn) => sum + fn.lines,
    0
  );

  const asyncCount = functions.filter(
    (fn) => fn.async
  ).length;

  const commonParamNames = [...paramCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name]) => name);

  return {
    functions,
    stats: {
      totalFunctions: functions.length,
      avgFunctionSize:
        functions.length > 0
          ? Math.round(totalLines / functions.length)
          : 0,
      asyncPercentage:
        functions.length > 0
          ? Math.round(
              (asyncCount / functions.length) * 100
            )
          : 0,
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
    paramCounts.set(
      param,
      (paramCounts.get(param) || 0) + 1
    );
  });

  functions.push({
    name,
    kind,
    params,
    async: isAsync,
    lines: endLine - startLine + 1,
    file,
  });
}
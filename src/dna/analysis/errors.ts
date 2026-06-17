import { Project, SyntaxKind } from "ts-morph";
import type { ErrorPattern } from "../types.js";

export function analyzeErrors(project: Project): ErrorPattern[] {
  const results: ErrorPattern[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (filePath.includes("node_modules") || filePath.endsWith(".d.ts")) continue;

    let tryCatch = 0;
    let promiseCatch = 0;
    let resultType = 0;
    let callbackErr = 0;
    const customExceptionNames = new Set<string>();

    tryCatch = sourceFile.getDescendantsOfKind(SyntaxKind.TryStatement).length;

    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpressionIfKind(SyntaxKind.PropertyAccessExpression);
      if (expr && expr.getName() === "catch") promiseCatch++;
    }

    for (const typeRef of sourceFile.getDescendantsOfKind(SyntaxKind.TypeReference)) {
      const name = typeRef.getTypeName().getText();
      if (/^(Result|Either|Option|Maybe)$/.test(name)) resultType++;
    }

    const fnLikeKinds = [
      SyntaxKind.FunctionDeclaration,
      SyntaxKind.FunctionExpression,
      SyntaxKind.ArrowFunction,
    ] as const;
    for (const kind of fnLikeKinds) {
      for (const fn of sourceFile.getDescendantsOfKind(kind)) {
        const params = fn.getParameters();
        const first = params[0];
        if (first && /^(err|error|e)$/.test(first.getName())) callbackErr++;
      }
    }

    for (const cls of sourceFile.getDescendantsOfKind(SyntaxKind.ClassDeclaration)) {
      const heritage = cls.getExtends();
      if (heritage?.getText() === "Error" && cls.getName()) {
        customExceptionNames.add(cls.getName()!);
      }
    }

    if (tryCatch === 0 && promiseCatch === 0 && resultType === 0 && callbackErr === 0 && customExceptionNames.size === 0) {
      continue;
    }

    const ranked: [ErrorPattern["style"], number][] = [
      ["try-catch", tryCatch],
      ["promise-catch", promiseCatch],
      ["result-type", resultType],
      ["callback-err", callbackErr],
    ];
    const dominant = ranked.reduce((a, b) => (b[1] > a[1] ? b : a));

    results.push({
      file: filePath,
      style: dominant[1] > 0 ? dominant[0] : "none",
      customExceptionNames: [...customExceptionNames],
    });
  }

  return results;
}

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
      if (expr && expr.getName() === "then") promiseChain++;
    }

    let callbacks = 0;
    const fnLikeKinds = [SyntaxKind.FunctionExpression, SyntaxKind.ArrowFunction] as const;
    for (const kind of fnLikeKinds) {
      for (const fn of sourceFile.getDescendantsOfKind(kind)) {
        const params = fn.getParameters();
        const first = params[0];
        const second = params[1];
        if (
          first && /^(err|error|e)$/.test(first.getName()) &&
          second && /^(result|res|data|value|val|body|response|cb)$/.test(second.getName())
        ) {
          callbacks++;
        }
      }
    }

    if (asyncAwait === 0 && promiseChain === 0 && callbacks === 0) continue;

    const total = asyncAwait + promiseChain + callbacks;
    let dominant: AsyncPattern["dominantStyle"];
    if (asyncAwait / total > 0.6) dominant = "async-await";
    else if (promiseChain / total > 0.6) dominant = "promise-chain";
    else if (callbacks / total > 0.6) dominant = "callbacks";
    else dominant = "mixed";

    results.push({
      file: filePath,
      usesAsyncAwait: asyncAwait > 0,
      usesPromiseChain: promiseChain > 0,
      usesCallbacks: callbacks > 0,
      dominantStyle: dominant,
    });
  }

  return results;
}

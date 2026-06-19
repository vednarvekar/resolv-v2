import { Project, SyntaxKind } from "ts-morph";
import type { CallGraphNode } from "../types.js";

export function analyzeCallGraph(project: Project): CallGraphNode[] {
  const graph: CallGraphNode[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (filePath.includes("node_modules") || filePath.endsWith(".d.ts")) continue;

    for (const fn of sourceFile.getFunctions()) {
      const calls = fn
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .map((call) => call.getExpression().getText());

      graph.push({
        functionName: fn.getName() ?? "anonymous",
        calls: [...new Set(calls)],
      });
    }
  }

  return graph;
}

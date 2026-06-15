import { Project, SyntaxKind } from "ts-morph";
import type { HelperUsage } from "../types.js";

export function analyzeHelpers(
  project: Project
): HelperUsage[] {

  const usageMap = new Map<
    string,
    { count: number; files: Set<string> }
  >();

  for (const sourceFile of project.getSourceFiles()) {

    const calls = sourceFile.getDescendantsOfKind(
      SyntaxKind.CallExpression
    );

    for (const call of calls) {

      const expr = call.getExpression();

      const name = expr.getText();

      if (!usageMap.has(name)) {
        usageMap.set(name, {
          count: 0,
          files: new Set()
        });
      }

      const entry = usageMap.get(name)!;

      entry.count++;

      entry.files.add(
        sourceFile.getFilePath()
      );
    }
  }

  return [...usageMap.entries()]
    .map(([name, data]) => ({
      name,
      usages: data.count,
      files: [...data.files]
    }))
    .sort((a, b) => b.usages - a.usages);
}

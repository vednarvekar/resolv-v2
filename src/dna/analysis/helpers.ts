import { Project, SyntaxKind } from "ts-morph";
import type { HelperUsage } from "../types.js";

const NATIVE_PREFIXES = /^(console|Promise|Math|Object|Array|JSON|String|Number|Error|Map|Set|Date)\./;
const NOISE_CALLS = new Set(["next", "require", "super", "cb", "callback"]);

export function analyzeHelpers(project: Project): HelperUsage[] {
  const usageMap = new Map<string, { count: number; files: Set<string> }>();

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (filePath.includes("node_modules") || filePath.endsWith(".d.ts")) continue;

    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const name = call.getExpression().getText();

      if (NATIVE_PREFIXES.test(name)) continue;
      if (!name.includes(".") && NOISE_CALLS.has(name)) continue;

      if (!usageMap.has(name)) usageMap.set(name, { count: 0, files: new Set() });
      const entry = usageMap.get(name)!;
      entry.count++;
      entry.files.add(filePath);
    }
  }

  return [...usageMap.entries()]
    .map(([name, data]) => ({ name, usages: data.count, files: [...data.files] }))
    // helpers used in only one file aren't "shared utilities" — keep multi-file ones
    .filter((h) => h.files.length >= 2 || h.usages >= 3)
    .sort((a, b) => b.usages - a.usages);
}

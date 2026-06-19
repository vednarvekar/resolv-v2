import { Project, SyntaxKind } from "ts-morph";
import type { NamingStats } from "../types.js";

const isCamel = (s: string) => /^[a-z][a-zA-Z0-9]*$/.test(s) && /[A-Z]/.test(s);
const isSnake = (s: string) => /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(s);
const isPascal = (s: string) => /^[A-Z][a-zA-Z0-9]*$/.test(s);
const isScreaming = (s: string) => /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(s);

/**
 * Counts identifier naming styles across the whole repo using real AST
 * Identifier nodes (not raw text), so string literals and comments never
 * pollute the count.
 */
export function analyzeNaming(project: Project): NamingStats {
  let camel = 0, snake = 0, pascal = 0, screaming = 0;

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (filePath.includes("node_modules") || filePath.endsWith(".d.ts")) continue;

    for (const idNode of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
      const name = idNode.getText();
      if (isScreaming(name)) { screaming++; continue; }
      if (isPascal(name)) { pascal++; continue; }
      if (isSnake(name)) { snake++; continue; }
      if (isCamel(name)) { camel++; continue; }
    }
  }

  const counts: [NamingStats["dominantStyle"], number][] = [
    ["camelCase", camel],
    ["snake_case", snake],
    ["PascalCase", pascal],
    ["SCREAMING_SNAKE", screaming],
  ];
  const top = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  const total = camel + snake + pascal + screaming;
  const dominantPct = total > 0 ? top[1] / total : 0;

  return {
    camelCase: camel,
    snake_case: snake,
    PascalCase: pascal,
    SCREAMING_SNAKE: screaming,
    dominantStyle: dominantPct > 0.5 ? top[0] : "mixed",
  };
}

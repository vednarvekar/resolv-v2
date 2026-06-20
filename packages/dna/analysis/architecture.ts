// packages/dna/analysis/architecture.ts
// Classifies files into architecture layers (route/controller/service/repository).
// Returns file path lists only — no raw import/call arrays.

import path from "node:path";
import { Project, SyntaxKind } from "ts-morph";
import type { ArchitectureInfo } from "../types.js";

function detectLayer(filePath: string, importSources: string[], callTexts: string[]): "route" | "controller" | "service" | "repository" | null {
  const lower = filePath.toLowerCase();

  const hasRoutingCall = callTexts.some(
    (c) => /\.(get|post|put|delete|patch|options|use|route|all)$/i.test(c)
  );
  if (hasRoutingCall) return "route";

  const hasDatabaseCall = callTexts.some(
    (c) => /\b(prisma|db|knex|mongoose|model|collection)\b/i.test(c) ||
      c.includes("findMany") || c.includes("findOne") || c.includes("insertMany")
  );
  if (hasDatabaseCall) return "repository";

  if (importSources.some((i) => /\/(db|repo|repository|model|prisma)\//i.test(i))) return "service";
  if (importSources.some((i) => /\/(service|usecase)\//i.test(i))) return "controller";

  if (lower.includes("route") || lower.includes("router")) return "route";
  if (lower.includes("controller")) return "controller";
  if (lower.includes("service")) return "service";
  if (lower.includes("repository") || lower.includes("repo")) return "repository";

  return null;
}

export function analyzeArchitecture(project: Project): ArchitectureInfo {
  const result: ArchitectureInfo = { routes: [], controllers: [], services: [], repositories: [] };

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (filePath.includes("node_modules") || filePath.endsWith(".d.ts")) continue;

    const imports = sourceFile.getImportDeclarations().map((i) => i.getModuleSpecifierValue());
    const calls = sourceFile
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .map((c) => c.getExpression().getText())
      .filter((t) => !/^(console|Promise|Math|Object|Array|JSON)\./.test(t));

    const layer = detectLayer(filePath, imports, calls);
    if (!layer) continue;

    const relativePath = path.basename(filePath);
    switch (layer) {
      case "route": result.routes.push(relativePath); break;
      case "controller": result.controllers.push(relativePath); break;
      case "service": result.services.push(relativePath); break;
      case "repository": result.repositories.push(relativePath); break;
    }
  }

  return result;
}
import { Project, SyntaxKind, CallExpression, TypeChecker } from "ts-morph";
import type { ArchitectureFlow, ArchitectureInfo } from "../types.js";

export function analyzeArchitecture(project: Project): ArchitectureInfo {
  const result: ArchitectureInfo = {
    routes: [], controllers: [], services: [], repositories: [],
  };

  const typeChecker = project.getTypeChecker();

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (filePath.includes("node_modules") || filePath.endsWith(".d.ts")) continue;

    const imports = sourceFile.getImportDeclarations().map((i) => i.getModuleSpecifierValue());

    const calls = sourceFile
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .filter((call) => isValidApplicationCall(call, typeChecker))
      .map((call) => call.getExpression().getText());

    const layer = detectLayer(filePath, imports, calls);

    const flow: ArchitectureFlow = {
      file: filePath,
      layer,
      imports,
      calls: [...new Set(calls)],
    };

    switch (layer) {
      case "route": result.routes.push(flow); break;
      case "controller": result.controllers.push(flow); break;
      case "service": result.services.push(flow); break;
      case "repository": result.repositories.push(flow); break;
    }
  }

  return result;
}

function detectLayer(
  filePath: string,
  imports: string[],
  calls: string[]
): ArchitectureFlow["layer"] {
  const hasRoutingCall = calls.some(
    (c) => /\.(get|post|put|delete|patch|options|head|use|route|all)$/i.test(c) || c === "route" || c === "router"
  );
  if (hasRoutingCall) return "route";

  const hasDatabaseCall = calls.some(
    (c) =>
      /\b(db|prisma|ctx\.db|database|knex|pg|mongoose|model|collection)\b/i.test(c) ||
      c.includes("findMany") || c.includes("findOne") || c.includes("insertMany")
  );
  if (hasDatabaseCall) return "repository";

  if (imports.some((i) => /\/(db|repo|repository|model|prisma|data|storage)\//i.test(i) || i.endsWith("db") || i.endsWith("model"))) {
    return "service";
  }

  if (imports.some((i) => /\/(service|usecase|domain)\//i.test(i) || i.endsWith("service"))) {
    return "controller";
  }

  const lower = filePath.toLowerCase();
  if (lower.includes("route") || lower.includes("router")) return "route";
  if (lower.includes("controller")) return "controller";
  if (lower.includes("service")) return "service";
  if (lower.includes("repository") || lower.includes("repo") || lower.includes("model")) return "repository";

  return "unknown";
}

/** Filters out native/global calls so the call list reflects real application logic. */
function isValidApplicationCall(call: CallExpression, typeChecker: TypeChecker): boolean {
  const expression = call.getExpression();
  const text = expression.getText();

  if (/^(console|Promise|Math|Object|Array|JSON|String|Number|Error)\./.test(text)) {
    return false;
  }

  const accessExpression = call.getExpressionIfKind(SyntaxKind.PropertyAccessExpression);
  if (accessExpression) {
    const baseType = typeChecker.getTypeAtLocation(accessExpression.getExpression());
    if (baseType.isArray() || baseType.isString() || baseType.isNumber()) {
      return false;
    }
  }

  if (!text.includes(".") && ["next", "require", "super", "cb", "callback"].includes(text)) {
    return false;
  }

  return true;
}
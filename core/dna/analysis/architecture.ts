import { Project, SyntaxKind, CallExpression } from "ts-morph";

export interface ArchitectureFlow {
  file: string;
  layer: "route" | "controller" | "service" | "repository" | "unknown";
  imports: string[];
  calls: string[];
}

export interface ArchitectureInfo {
  routes: ArchitectureFlow[];
  controllers: ArchitectureFlow[];
  services: ArchitectureFlow[];
  repositories: ArchitectureFlow[];
}

export function analyzeArchitecture(project: Project): ArchitectureInfo {
  const result: ArchitectureInfo = {
    routes: [],
    controllers: [],
    services: [],
    repositories: []
  };

  // Get the type checker to inspect true types, not just text strings
  const typeChecker = project.getTypeChecker();

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();

    if (filePath.includes("node_modules") || filePath.endsWith(".d.ts")) continue;

    const imports = sourceFile
      .getImportDeclarations()
      .map(i => i.getModuleSpecifierValue());

    // Fixes Problem 4: Filter out native JS globals, built-ins, and isolated tokens
    const calls = sourceFile
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .filter(call => isValidApplicationCall(call, typeChecker))
      .map(call => call.getExpression().getText());

    const layer = detectLayer(filePath, imports, calls);

    const flow: ArchitectureFlow = {
      file: filePath,
      layer,
      imports,
      calls: [...new Set(calls)]
    };

    switch (layer) {
      case "route":      result.routes.push(flow); break;
      case "controller": result.controllers.push(flow); break;
      case "service":    result.services.push(flow); break;
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

  // Fixes Problem 2: Broaden routing detection via common framework syntax patterns
  const hasRoutingCall = calls.some(c => 
    /\.(get|post|put|delete|patch|options|head|use|route|all)$/i.test(c) ||
    c === "route" || c === "router"
  );
  if (hasRoutingCall) return "route";

  // Fixes Problem 1: Catch database context patterns (ctx.db, database, mongo, prisma, etc.)
  const hasDatabaseCall = calls.some(c => 
    /\b(db|prisma|ctx\.db|database|prisma|knex|pg|mongoose|model|collection)\b/i.test(c) ||
    c.includes("findMany") || c.includes("findOne") || c.includes("insertMany")
  );
  if (hasDatabaseCall) return "repository";

  // Fixes Problem 3: Detect layer transitions based on structural dependency paths
  if (imports.some(i => /\/(db|repo|repository|model|prisma|data|storage)\//i.test(i) || i.endsWith("db") || i.endsWith("model"))) {
    return "service"; 
  }

  if (imports.some(i => /\/(service|usecase|domain)\//i.test(i) || i.endsWith("service"))) {
    return "controller"; 
  }

  // Final fallback
  const lower = filePath.toLowerCase();
  if (lower.includes("route") || lower.includes("router")) return "route";
  if (lower.includes("controller")) return "controller";
  if (lower.includes("service")) return "service";
  if (lower.includes("repository") || lower.includes("repo") || lower.includes("model")) return "repository";

  return "unknown";
}

/**
 * Validates if a call expression belongs to your app code instead of runtime noise
 */
function isValidApplicationCall(call: CallExpression, typeChecker: any): boolean {
  const expression = call.getExpression();
  const text = expression.getText();

  // 1. Instantly skip obvious native/global namespaces
  if (/^(console|Promise|Math|Object|Array|JSON|String|Number|Error)\./.test(text)) {
    return false;
  }

  // 2. Filter out plain array/string methods (like .map, .filter, .split) via Type Checker
  const accessExpression = call.getExpressionIfKind(SyntaxKind.PropertyAccessExpression);
  if (accessExpression) {
    const baseType = typeChecker.getTypeAtLocation(accessExpression.getExpression());
    if (baseType.isArray() || baseType.isString() || baseType.isNumber()) {
      return false;
    }
  }

  // 3. Reject standalone keywords or single isolated utility tokens (e.g. `next()`, `require()`)
  if (!text.includes(".") && ["next", "require", "super", "cb", "callback"].includes(text)) {
    return false;
  }

  return true;
}
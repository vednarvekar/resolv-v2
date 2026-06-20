// packages/dna/analysis/exports.ts
// Extracts exported symbols per file. Returns name + type only —
// no raw AST nodes, no line numbers, no docstrings.

import path from "node:path";
import { Project } from "ts-morph";
import type { ExportIndex, ExportInfo } from "../types.js";

export function analyzeExports(project: Project, repoRoot: string): ExportIndex {
  const out: ExportIndex = {};

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (filePath.includes("node_modules") || filePath.endsWith(".d.ts")) continue;

    const fileExports: ExportInfo[] = [];
    const exportedDecls = sourceFile.getExportedDeclarations();

    for (const [name, decls] of exportedDecls) {
      for (const decl of decls) {
        const kindName = decl.getKindName();
        let type: ExportInfo["type"] = "unknown";

        if (kindName === "FunctionDeclaration" || kindName === "ArrowFunction" || kindName === "FunctionExpression") {
          type = "function";
        } else if (kindName === "ClassDeclaration") {
          type = "class";
        } else if (kindName === "InterfaceDeclaration" || kindName === "TypeAliasDeclaration") {
          type = "interface";
        } else if (kindName === "VariableDeclaration") {
          type = "constant";
        }

        const isDefault = sourceFile.getDefaultExportSymbol()?.getName() === name;
        fileExports.push({ name, type, isDefault });
        break; // one entry per exported name is enough
      }
    }

    if (fileExports.length > 0) {
      out[path.relative(repoRoot, filePath)] = fileExports;
    }
  }

  return out;
}
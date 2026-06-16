import fs from "node:fs";
import path from "node:path";
import { Project } from "ts-morph";
import type { RepoFile, ExportInfo } from "../types.js";

function analyzePythonExports(file: RepoFile): ExportInfo[] {
  const content = fs.readFileSync(file.absolutePath, "utf-8");
  const fileExports: ExportInfo[] = [];

  for (const line of content.split("\n")) {
    if (!line.startsWith("def ") && !line.startsWith("class ")) continue;

    const match = line.match(/^(def|class)\s+(\w+)/);
    if (!match) continue;
    const [, keyword, name] = match;
    if (!keyword || !name) continue;
    if (name.startsWith("_")) continue; // private by convention

    fileExports.push({
      name,
      type: keyword === "class" ? "class" : "function",
      isDefault: false,
    });
  }

  return fileExports;
}

/** Single source of truth for export analysis — ts-morph AST for JS/TS, regex for Python. */
export function analyzeExports(
  files: RepoFile[],
  project: Project,
  repoPath: string
): Record<string, ExportInfo[]> {
  const out: Record<string, ExportInfo[]> = {};

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
      }
    }

    const relPath = path.relative(repoPath, filePath);
    if (fileExports.length > 0) out[relPath] = fileExports;
  }

  for (const file of files) {
    if (file.language !== "python") continue;
    const fileExports = analyzePythonExports(file);
    if (fileExports.length > 0) out[file.relativePath] = fileExports;
  }

  return out;
}
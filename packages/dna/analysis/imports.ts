import fs from "node:fs";
import path from "node:path";
import { Project, SyntaxKind } from "ts-morph";
import type { RepoFile, ImportInfo } from "../types.js";

function rootPackageName(source: string): string {
  if (source.startsWith("@")) return source.split("/").slice(0, 2).join("/");
  return source.split("/")[0] ?? source;
}

function isLocalSource(source: string): boolean {
  return source.startsWith(".") || source.startsWith("/") || source.startsWith("~");
}

function analyzePythonImports(file: RepoFile): ImportInfo[] {
  const content = fs.readFileSync(file.absolutePath, "utf-8");
  const fileImports: ImportInfo[] = [];

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();

    if (line.startsWith("import ")) {
      const modules = line.replace("import ", "").split(",");
      for (const mod of modules) {
        const name = mod.trim().split(" as ")[0]?.trim();
        if (!name) continue;
        fileImports.push({ source: name, symbols: [], isExternal: !name.startsWith(".") });
      }
      continue;
    }

    if (line.startsWith("from ")) {
      const match = line.match(/^from\s+(\S+)\s+import\s+([\s\S]+)$/);
      if (match?.[1] && match[2]) {
        const source = match[1];
        const symbols = match[2]
          .split(",")
          .map((s) => s.trim().split(" as ")[0]?.trim() ?? "")
          .filter(Boolean);
        fileImports.push({ source, symbols, isExternal: !source.startsWith(".") });
      }
    }
  }

  return fileImports;
}

/**
 * Single source of truth for import analysis.
 * JS/TS files are read from the already-built ts-morph Project (one AST, reused
 * across every analyzer). Python files fall back to regex since ts-morph can't
 * parse them.
 */
export function analyzeImports(
  files: RepoFile[],
  project: Project,
  repoPath: string
): Record<string, ImportInfo[]> {
  const out: Record<string, ImportInfo[]> = {};

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (filePath.includes("node_modules") || filePath.endsWith(".d.ts")) continue;

    const fileImports: ImportInfo[] = [];

    for (const decl of sourceFile.getImportDeclarations()) {
      const source = decl.getModuleSpecifierValue();
      const symbols: string[] = [];

      const defaultImport = decl.getDefaultImport();
      if (defaultImport) symbols.push(defaultImport.getText());

      const namespaceImport = decl.getNamespaceImport();
      if (namespaceImport) symbols.push(`* as ${namespaceImport.getText()}`);

      for (const named of decl.getNamedImports()) symbols.push(named.getName());

      fileImports.push({ source, symbols, isExternal: !isLocalSource(source) });
    }

    // require('x') calls — common in mixed/older JS codebases
    for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (callExpr.getExpression().getText() !== "require") continue;
      const arg = callExpr.getArguments()[0];
      if (!arg) continue;
      const text = arg.getText().replace(/^['"]|['"]$/g, "");
      fileImports.push({ source: text, symbols: [], isExternal: !isLocalSource(text) });
    }

    const relPath = path.relative(repoPath, filePath);
    if (fileImports.length > 0) out[relPath] = fileImports;
  }

  for (const file of files) {
    if (file.language !== "python") continue;
    const fileImports = analyzePythonImports(file);
    if (fileImports.length > 0) out[file.relativePath] = fileImports;
  }

  return out;
}

export function getUniqueExternalDependencies(
  imports: Record<string, ImportInfo[]>
): string[] {
  const set = new Set<string>();
  for (const list of Object.values(imports)) {
    for (const imp of list) {
      if (imp.isExternal) set.add(rootPackageName(imp.source));
    }
  }
  return [...set];
}

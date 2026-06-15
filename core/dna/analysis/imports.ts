import fs from "fs";
import path from "path";
import type { RepoFile } from "./files.js";

export interface ImportDetail {
  moduleName: string;   // e.g., "fastify", "react", "@/utils/logger"
  isLocal: boolean;     // true if it's an internal file import
  importedSymbols: string[]; // e.g., ["useState", "useEffect"]
}

export interface RepoImportsProfile {
  uniqueExternalDependencies: string[];
  localPathAliases: string[];
  importFrequency: Record<string, number>;
  rawFileImports: Record<string, ImportDetail[]>;
}

export function analyzeImports(files: RepoFile[], repoPath: string): RepoImportsProfile {
  const profile: RepoImportsProfile = {
    uniqueExternalDependencies: [],
    localPathAliases: [],
    importFrequency: {},
    rawFileImports: {}
  };

  const externalSet = new Set<string>();
  const aliasSet = new Set<string>();

  for (const file of files) {
    const content = fs.readFileSync(file.absolutePath, "utf-8");
    const fileImports: ImportDetail[] = [];

    if (file.language === "typescript" || file.language === "javascript") {
      // Matches: import { a, b } from "module" or import x from 'module'
      const matches = content.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g);
      for (const match of matches) {
        const symbolsStr = match[1];
        const source = match[2];
        if (!symbolsStr || !source) continue;
        const isLocal = source.startsWith(".") || source.startsWith("@/") || source.startsWith("~");

        // Extract individual named symbols inside braces or default import name
        const symbols: string[] = [];
        const braceMatch = symbolsStr.match(/\{([\s\S]*?)\}/);
        if (braceMatch?.[1]) {
          symbols.push(...braceMatch[1].split(",").map(s => s.trim()).filter(Boolean));
        } else {
          const cleanDefault = symbolsStr.replace(/\s*\*+as\s+/, "").trim();
          if (cleanDefault) symbols.push(cleanDefault);
        }

        fileImports.push({ moduleName: source, isLocal, importedSymbols: symbols });
        profile.importFrequency[source] = (profile.importFrequency[source] || 0) + 1;

        if (isLocal) {
          if (source.startsWith("@/") || source.startsWith("~")) {
            const alias = source.split("/")[0] ?? source;
            aliasSet.add(alias);
          }
        } else {
          // Get root package name (e.g., "lodash/fp" -> "lodash")
          const rootPackage = source.startsWith("@") ? source.split("/").slice(0, 2).join("/") : source.split("/")[0] ?? source;
          externalSet.add(rootPackage);
        }
      }
    } else if (file.language === "python") {
      // Matches: import os, sys OR from datetime import datetime
      const lines = content.split("\n");
      for (const line of lines) {
        const cleanLine = line.trim();
        if (cleanLine.startsWith("import ")) {
          const modules = cleanLine.replace("import ", "").split(",");
          for (const mod of modules) {
            const name = mod.trim().split(" as ")[0]?.trim();
            if (!name) continue;
            const isLocal = name.startsWith(".");
            fileImports.push({ moduleName: name, isLocal, importedSymbols: [] });
            profile.importFrequency[name] = (profile.importFrequency[name] || 0) + 1;
            if (!isLocal) externalSet.add(name.split(".")[0] ?? name);
          }
        } else if (cleanLine.startsWith("from ")) {
          const match = cleanLine.match(/^from\s+(\S+)\s+import\s+([\s\S]+)$/);
          if (match?.[1] && match[2]) {
            const source = match[1];
            const symbols = match[2].split(",").map(s => s.trim().split(" as ")[0]?.trim() ?? "");
            const isLocal = source.startsWith(".");
            fileImports.push({ moduleName: source, isLocal, importedSymbols: symbols });
            profile.importFrequency[source] = (profile.importFrequency[source] || 0) + 1;
            if (!isLocal) externalSet.add(source.split(".")[0] ?? source);
          }
        }
      }
    }

    profile.rawFileImports[file.relativePath] = fileImports;
  }

  profile.uniqueExternalDependencies = Array.from(externalSet);
  profile.localPathAliases = Array.from(aliasSet);

  return profile;
}

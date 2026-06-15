import fs from "fs";
import type { RepoFile } from "./files.js";

export interface ExportDetail {
  name: string;
  type: "function" | "class" | "interface" | "constant" | "unknown";
  isDefault: boolean;
}

export function analyzeExports(files: RepoFile[]): Record<string, ExportDetail[]> {
  const repoExports: Record<string, ExportDetail[]> = {};

  for (const file of files) {
    const content = fs.readFileSync(file.absolutePath, "utf-8");
    const fileExports: ExportDetail[] = [];

    if (file.language === "typescript" || file.language === "javascript") {
      // Named exports: export const myVar, export function myFunc, export class MyClass
      const namedMatches = content.matchAll(/export\s+(const|let|var|function|class|interface|type)\s+(\w+)/g);
      for (const match of namedMatches) {
        const keyword = match[1];
        const name = match[2];
        if (!keyword || !name) continue;
        
        let type: ExportDetail["type"] = "unknown";
        if (keyword === "function") type = "function";
        else if (keyword === "class") type = "class";
        else if (keyword === "interface" || keyword === "type") type = "interface";
        else if (["const", "let", "var"].includes(keyword)) type = "constant";

        fileExports.push({ name, type, isDefault: false });
      }

      // Default exports: export default function myFunc or export default MyClass
      const defaultMatches = content.matchAll(/export\s+default\s+(function|class)?\s*(\w+)/g);
      for (const match of defaultMatches) {
        const keyword = match[1];
        const name = match[2];
        if (!name) continue;
        const type = keyword === "class" ? "class" : "function";
        fileExports.push({ name, type, isDefault: true });
      }
    } else if (file.language === "python") {
      // In Python, anything declared at the root level of the module without a leading underscore is "exported"
      const lines = content.split("\n");
      for (const line of lines) {
        if (line.startsWith("def ") || line.startsWith("class ")) {
          const match = line.match(/^(def|class)\s+(\w+)/);
          if (match) {
            const keyword = match[1];
            const name = match[2];
            if (!keyword || !name) continue;
            // Skip internal private functions/classes starting with '_'
            if (!name.startsWith("_")) {
              fileExports.push({
                name,
                type: keyword === "class" ? "class" : "function",
                isDefault: false
              });
            }
          }
        }
      }
    }

    repoExports[file.relativePath] = fileExports;
  }

  return repoExports;
}

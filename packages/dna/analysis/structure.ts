import fs from "node:fs";
import path from "node:path";
import type { FolderNode } from "../types.js";

const IGNORE = new Set([
  "node_modules", ".git", "dist", "build", ".next",
  "__pycache__", ".venv", "venv", "coverage", ".nyc_output",
]);

export function analyzeStructure(repoRoot: string): FolderNode {
  function walk(dir: string): FolderNode {
    const name = path.basename(dir) || dir;
    const node: FolderNode = { name, path: dir, children: [], fileCount: 0 };

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return node;
    }

    for (const entry of entries) {
      if (IGNORE.has(entry.name)) continue;

      if (entry.isDirectory()) {
        node.children.push(walk(path.join(dir, entry.name)));
      } else {
        node.fileCount++;
      }
    }

    return node;
  }

  return walk(repoRoot);
}
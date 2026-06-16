import fs from "node:fs";
import path from "node:path";

export interface FileChange {
  filePath: string;
  newContent: string;
}

/**
 * Parses the LLM's response for one or more file blocks and writes them to disk.
 * Expected format from the model:
 *
 * ```file:src/utils/foo.ts
 * <full file contents>
 * ```
 *
 * Falls back to treating the whole response as a single file's content if
 * exactly one target file was given and no fenced blocks are found.
 */
export function parseFileChanges(llmResponse: string): FileChange[] {
  const changes: FileChange[] = [];
  const blockRegex = /```file:([^\n]+)\n([\s\S]*?)```/g;

  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(llmResponse)) !== null) {
    const filePath = match[1]?.trim();
    const content = match[2];
    if (!filePath || content === undefined) continue;
    changes.push({ filePath, newContent: content });
  }

  return changes;
}

export function applyFileChanges(repoRoot: string, changes: FileChange[]): string[] {
  const written: string[] = [];

  for (const change of changes) {
    const absPath = path.resolve(repoRoot, change.filePath);

    // safety: never write outside the repo root
    if (!absPath.startsWith(path.resolve(repoRoot))) {
      throw new Error(`Refusing to write outside repo root: ${change.filePath}`);
    }

    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, change.newContent, "utf-8");
    written.push(change.filePath);
  }

  return written;
}
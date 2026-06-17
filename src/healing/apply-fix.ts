import fs from "node:fs";
import path from "node:path";

export interface FileChange {
  filePath: string;
  newContent: string;
}

interface SearchReplaceBlock {
  filePath: string;
  search: string;
  replace: string;
}

/**
 * Parses SEARCH/REPLACE blocks — the cheap, surgical edit format.
 * Expected shape:
 *
 * ```file:src/utils/foo.ts
 * <<<<<<< SEARCH
 * old code
 * =======
 * new code
 * >>>>>>> REPLACE
 * ```
 * Multiple SEARCH/REPLACE blocks can target the same file in one response.
 */
function parseSearchReplaceBlocks(llmResponse: string): SearchReplaceBlock[] {
  const blocks: SearchReplaceBlock[] = [];
  const fileBlockRegex = /```file:([^\n]+)\n([\s\S]*?)```/g;
  const srRegex = /<{7}\s*SEARCH\n([\s\S]*?)\n={7}\n([\s\S]*?)\n>{7}\s*REPLACE/g;

  let fileMatch: RegExpExecArray | null;
  while ((fileMatch = fileBlockRegex.exec(llmResponse)) !== null) {
    const filePath = fileMatch[1]?.trim();
    const body = fileMatch[2];
    if (!filePath || body === undefined) continue;

    // does this file block contain SEARCH/REPLACE pairs, or a full file dump?
    let srMatch: RegExpExecArray | null;
    let foundAny = false;
    srRegex.lastIndex = 0;
    while ((srMatch = srRegex.exec(body)) !== null) {
      foundAny = true;
      const search = srMatch[1];
      const replace = srMatch[2];
      if (search === undefined || replace === undefined) continue;
      blocks.push({ filePath, search, replace });
    }

    if (!foundAny) {
      // no SEARCH/REPLACE markers inside this file block — treat whole body
      // as a full-file replacement, flagged via empty search string
      blocks.push({ filePath, search: "", replace: body });
    }
  }

  return blocks;
}

/**
 * Parses the LLM's response into concrete FileChange objects.
 * Priority: SEARCH/REPLACE blocks (cheap, surgical) > full ```file:path``` dumps.
 * Falls back to nothing if the model didn't follow either format — caller must
 * handle the empty-array case (treat as a failed attempt and retry/feed back).
 */
export function parseFileChanges(llmResponse: string, repoRoot: string): FileChange[] {
  const blocks = parseSearchReplaceBlocks(llmResponse);
  if (blocks.length === 0) return [];

  // group blocks by file so multiple SEARCH/REPLACE pairs apply in sequence
  const byFile = new Map<string, SearchReplaceBlock[]>();
  for (const block of blocks) {
    if (!byFile.has(block.filePath)) byFile.set(block.filePath, []);
    byFile.get(block.filePath)!.push(block);
  }

  const changes: FileChange[] = [];

  for (const [filePath, fileBlocks] of byFile) {
    const absPath = path.resolve(repoRoot, filePath);

    // full-file replacement: single block with empty search marker
    if (fileBlocks.length === 1 && fileBlocks[0]?.search === "") {
      changes.push({ filePath, newContent: fileBlocks[0].replace });
      continue;
    }

    // surgical edit: read existing content, apply each search/replace in order
    let current: string;
    try {
      current = fs.readFileSync(absPath, "utf-8");
    } catch {
      // file doesn't exist yet — can't search/replace against nothing,
      // so concatenate the replace bodies as a best-effort new file
      current = fileBlocks.map((b) => b.replace).join("\n");
      changes.push({ filePath, newContent: current });
      continue;
    }

    let failed = false;
    for (const block of fileBlocks) {
      if (!current.includes(block.search)) {
        // search text not found verbatim — likely whitespace drift from the LLM.
        // Don't silently corrupt the file; mark this file as failed so the
        // caller can report it back to the model as a failed attempt.
        failed = true;
        break;
      }
      current = current.replace(block.search, block.replace);
    }

    if (!failed) {
      changes.push({ filePath, newContent: current });
    }
  }

  return changes;
}

export function applyFileChanges(repoRoot: string, changes: FileChange[]): string[] {
  const written: string[] = [];
  const resolvedRoot = path.resolve(repoRoot);

  for (const change of changes) {
    const absPath = path.resolve(repoRoot, change.filePath);

    // safety: never write outside the repo root
    if (!absPath.startsWith(resolvedRoot)) {
      throw new Error(`Refusing to write outside repo root: ${change.filePath}`);
    }

    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, change.newContent, "utf-8");
    written.push(change.filePath);
  }

  return written;
}

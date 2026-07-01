// packages/llm/tools/llm-tools.ts
// Thin assembler for tool groups. The actual tool definitions live in
// domain-specific modules so this file stays small and easy to scan.

import type { ToolDefinition } from "../../core/types.js";
import { readGitignorePatterns } from "./tool-utils.js";
import { createFilesystemTools } from "./filesystem-tools.js";
import { createRepoTools } from "./repo-tools.js";
import { createRemoteTools } from "./remote-tools.js";

export function createLLMTools(repoRoot: string): ToolDefinition[] {
  const gitignorePatterns = readGitignorePatterns(repoRoot);
  return [
    ...createFilesystemTools(repoRoot, gitignorePatterns),
    ...createRepoTools(repoRoot),
    ...createRemoteTools(),
  ];
}

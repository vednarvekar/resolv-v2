import type { ToolRegistry } from "../packages/orchestrator-agent/tool-registry.js";

export interface EvalFixture {
  /** Files to write into a fresh temp repo before the eval runs. path -> content */
  files: Record<string, string>;
  /** Shell commands to run after writing files (e.g. `git init`, `npm install`). */
  setupCommands?: string[];
}

export interface EvalCase {
  id: string;
  description: string;
  category: "capability" | "guardrail";
  fixture: EvalFixture;
  /** The task text fed to the agent as the user message (simulates the issue). */
  task: string;
  testCommand: string;
  maxToolCallRounds?: number;
  /**
   * Runs after the agent turn completes. Receives the repo root so it can
   * inspect on-disk state (not just the agent's final text, which an LLM
   * could hallucinate success in). Return a list of failed assertion
   * messages; empty array = pass.
   */
  assert: (ctx: EvalAssertContext) => Promise<string[]> | string[];
}

export interface EvalAssertContext {
  repoRoot: string;
  responseText: string;
  toolCallRounds: number;
  toolCallLog: { name: string; input: Record<string, unknown> }[];
  hitRoundLimit: boolean;
  errored: boolean;
}

export interface EvalResult {
  id: string;
  category: EvalCase["category"];
  passed: boolean;
  failures: string[];
  durationMs: number;
  toolCallRounds: number;
  error?: string;
}

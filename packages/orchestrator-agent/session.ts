// ============================================================
// resolv — orchestrator-agent/session.ts
// Holds conversation history plus the small bits of mutable context (repo
// path, current branch, last DNA scan summary) that both the system prompt
// and various tools need to read or update during a run.
// ============================================================

import type { Message } from "../core/types.js";
import type { SystemPromptContext } from "./system-prompt.js";

export class AgentSession {
  private history: Message[] = [];
  private context: SystemPromptContext = {};

  // ── conversation history ──────────────────────────────────

  addMessage(message: Message): void {
    this.history.push(message);
  }

  getHistory(): readonly Message[] {
    return this.history;
  }

  clearHistory(): void {
    this.history = [];
  }

  /** Drops everything except the most recent N messages — a basic context-length safety valve. */
  truncateHistory(keepLast: number): void {
    if (this.history.length > keepLast) {
      this.history = this.history.slice(-keepLast);
    }
  }

  // ── session context ───────────────────────────────────────

  getContext(): Readonly<SystemPromptContext> {
    return this.context;
  }

  setRepoPath(repoPath: string): void {
    this.context.repoPath = repoPath;
  }

  setCurrentBranch(branch: string): void {
    this.context.currentBranch = branch;
  }

  setStyleSummary(summary: string): void {
    this.context.styleSummary = summary;
  }
}
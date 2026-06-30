// packages/orchestrator-agent/session.ts
// Conversation history + mutable session context.

import type { Message } from "../core/types.js";
import type { SystemPromptContext } from "./system-prompt.js";

export class AgentSession {
  private history: Message[] = [];
  private context: SystemPromptContext = {};

  // ── History ───────────────────────────────────────────────

  addMessage(message: Message): void {
    this.history.push(message);
  }

  getHistory(): readonly Message[] {
    return this.history;
  }

  clearHistory(): void {
    this.history = [];
  }

  /** Restore history from a persisted session (e.g. via /resume). */
  restoreHistory(history: Message[]): void {
    this.history = [...history];
  }

  /** Keep only the N most recent messages to manage context length. */
  truncateHistory(keepLast: number): void {
    if (this.history.length > keepLast) {
      this.history = this.history.slice(-keepLast);
    }
  }

  // ── Context ───────────────────────────────────────────────

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
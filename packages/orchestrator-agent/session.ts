// packages/orchestrator-agent/session.ts
// Conversation history + mutable session context.
// Tracks whether the system prompt has been sent (it's only needed on the first turn).

import type { Message } from "../core/types.js";
import type { SystemPromptContext } from "./system-prompt.js";

export class AgentSession {
  private history: Message[] = [];
  private context: SystemPromptContext = {};
  private _firstTurnDone = false;

  // ── History ───────────────────────────────────────────────

  addMessage(message: Message): void {
    this.history.push(message);
  }

  getHistory(): readonly Message[] {
    return this.history;
  }

  clearHistory(): void {
    this.history = [];
    this._firstTurnDone = false;
  }

  /** Restore history from a persisted session. Marks first turn as done since
   *  history already contains the system prompt from the original session. */
  restoreHistory(history: Message[]): void {
    this.history = [...history];
    this._firstTurnDone = history.length > 0;
  }

  /** Keep only the N most recent messages to manage context length. */
  truncateHistory(keepLast: number): void {
    if (this.history.length > keepLast) {
      this.history = this.history.slice(-keepLast);
    }
  }

  // ── System prompt tracking ────────────────────────────────

  isFirstTurn(): boolean {
    return !this._firstTurnDone;
  }

  markFirstTurnDone(): void {
    this._firstTurnDone = true;
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
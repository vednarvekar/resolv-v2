// ============================================================
// resolv — core/events.ts
// A tiny typed event emitter. Not using node:events directly so that
// listeners are statically typed against AgentEvent's discriminated union
// instead of stringly-typed event names.
// ============================================================

import type { AgentEvent } from "./types.js";

type Listener = (event: AgentEvent) => void;

export class AgentEventBus {
  private listeners: Listener[] = [];

  on(listener: Listener): () => void {
    this.listeners.push(listener);
    // returns an unsubscribe function — callers don't need to track listener identity themselves
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  clear(): void {
    this.listeners = [];
  }
}
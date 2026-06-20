// packages/session/persistence.ts
// Chat session persistence. Saves conversation history + metadata to
// ~/.config/resolv/sessions/<id>.json so users can resume across process restarts.
//
// Session ID is a short human-readable ID (e.g. "abc123") shown on exit.
// Resume with: /resume <id>  or  resolv --resume <id>

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Message } from "../../core/types.js";

const SESSIONS_DIR = path.join(os.homedir(), ".config", "resolv", "sessions");
const MAX_SESSIONS = 50; // prune oldest sessions beyond this limit

export interface SessionMeta {
  id: string;
  createdAt: string;
  updatedAt: string;
  provider: string;
  model: string;
  repoPath: string;
  /** First user message — used as a human-readable title */
  title: string;
  messageCount: number;
}

export interface PersistedSession {
  meta: SessionMeta;
  history: Message[];
}

function ensureSessionsDir(): void {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

/** Generate a short 6-char hex ID */
function generateId(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sessionPath(id: string): string {
  return path.join(SESSIONS_DIR, `${id}.json`);
}

export function saveSession(
  id: string,
  history: Message[],
  provider: string,
  model: string,
  repoPath: string
): void {
  ensureSessionsDir();

  const firstUserMsg = history.find((m) => m.role === "user");
  const title = firstUserMsg?.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("")
    .slice(0, 60) ?? "Untitled";

  const existing = loadSession(id);
  const createdAt = existing?.meta.createdAt ?? new Date().toISOString();

  const session: PersistedSession = {
    meta: {
      id,
      createdAt,
      updatedAt: new Date().toISOString(),
      provider,
      model,
      repoPath,
      title,
      messageCount: history.length,
    },
    history,
  };

  fs.writeFileSync(sessionPath(id), JSON.stringify(session, null, 2), { mode: 0o600 });
  pruneOldSessions();
}

export function loadSession(id: string): PersistedSession | null {
  const p = sessionPath(id);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as PersistedSession;
  } catch {
    return null;
  }
}

export function listSessions(): SessionMeta[] {
  ensureSessionsDir();
  const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
  const sessions: SessionMeta[] = [];

  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, file), "utf-8")) as PersistedSession;
      sessions.push(raw.meta);
    } catch {
      // skip corrupt files
    }
  }

  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function deleteSession(id: string): boolean {
  const p = sessionPath(id);
  if (!fs.existsSync(p)) return false;
  fs.rmSync(p);
  return true;
}

/** Keep only the most recent MAX_SESSIONS sessions. */
function pruneOldSessions(): void {
  const sessions = listSessions();
  if (sessions.length <= MAX_SESSIONS) return;
  for (const old of sessions.slice(MAX_SESSIONS)) {
    deleteSession(old.id);
  }
}

export function newSessionId(): string {
  return generateId();
}
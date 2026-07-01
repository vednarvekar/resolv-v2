import chalk from "chalk";

import { PROVIDER_INFO } from "../../config/config.js";
import { saveSession, loadSession, listSessions, newSessionId } from "../../packages/llm/session/persistence.js";
import type { ReplState } from "./repl-state.js";
import { createProviderFromEnv } from "../../packages/providers/register.js";
import { retryTransientProviderOperation } from "../../packages/providers/retry.js";
import { loadAppConfig, loadConfig } from "../../config/config.js";

export function persistCurrentSession(state: ReplState): void {
  const history = [...state.session.getHistory()];
  if (history.length > 0) {
    saveSession(state.sessionId, history, state.config.provider, state.activeModel, process.cwd());
    console.log(chalk.dim(`\n  Session saved. Resume with: /resume ${state.sessionId}`));
    console.log(chalk.dim(`  Or: resolv --resume ${state.sessionId}\n`));
  } else {
    console.log(chalk.dim("\n  Goodbye.\n"));
  }
}

export async function reactivateProvider(state: ReplState): Promise<void> {
  try {
    const nextConfig = loadConfig();
    const nextInfo = PROVIDER_INFO[nextConfig.provider]!;
    const nextModel = nextConfig.model ?? nextInfo.defaultModel;
    const nextProvider = createProviderFromEnv(nextConfig);
    await retryTransientProviderOperation(
      () => nextProvider.healthCheck?.(nextModel) ?? Promise.resolve(),
      { retries: 1 },
    );
    state.config = nextConfig;
    state.appConfig = loadAppConfig();
    state.providerInfo = nextInfo;
    state.activeModel = nextModel;
    state.provider = nextProvider;
    state.providerConnected = true;
    console.log(chalk.green(`  ✓ Active: ${nextInfo.label} / ${nextModel}\n`));
  } catch (err) {
    state.providerConnected = false;
    console.log(chalk.red(`  Could not activate provider: ${err instanceof Error ? err.message : String(err)}\n`));
    console.log(chalk.dim("  Use /provider to choose a different provider or /model to update the active model.\n"));
  }
}

export function saveSessionIfNeeded(state: ReplState): void {
  const userMsgCount = state.session.getHistory().filter((m) => m.role === "user").length;
  if (userMsgCount % 5 === 0) {
    saveSession(state.sessionId, [...state.session.getHistory()], state.config.provider, state.activeModel, process.cwd());
  }
}

export function saveSessionBeforeSwap(state: ReplState): void {
  const currentHistory = [...state.session.getHistory()];
  if (currentHistory.length > 0) {
    saveSession(state.sessionId, currentHistory, state.config.provider, state.activeModel, process.cwd());
  }
}

export function startNewSession(state: ReplState): void {
  saveSessionBeforeSwap(state);
  state.sessionId = newSessionId();
  state.session.clearHistory();
  state.session.setRepoPath(process.cwd());
  console.log(chalk.green(`  ✓ New session: ${state.sessionId}\n`));
}

export function resumeSession(state: ReplState, id: string): void {
  const persisted = loadSession(id);
  if (!persisted) {
    console.log(chalk.red(`  Session "${id}" not found. Use /sessions to list.\n`));
    return;
  }

  saveSessionBeforeSwap(state);
  state.sessionId = id;
  state.session.restoreHistory(persisted.history);
  console.log(chalk.green(`  ✓ Resumed session ${id} (${persisted.history.length} messages)\n`));
}

export function printSessions(state: ReplState): void {
  const sessions = listSessions();
  if (sessions.length === 0) {
    console.log(chalk.dim("\n  No saved sessions.\n"));
    return;
  }

  console.log("");
  console.log(chalk.hex("#7c3aed").bold("  Recent sessions"));
  console.log(chalk.dim("  " + "─".repeat(52)));
  for (const s of sessions.slice(0, 10)) {
    const active = s.id === state.sessionId ? chalk.green(" ← current") : "";
    const when = new Date(s.updatedAt).toLocaleString();
    console.log(`  ${chalk.cyan(s.id)}  ${s.title.slice(0, 40).padEnd(40)}  ${chalk.dim(when)}${active}`);
  }
  console.log(chalk.dim("\n  Use /resume <id> to restore a session.\n"));
}

export function printHistory(state: ReplState): void {
  const h = state.session.getHistory();
  const turns = h.filter((m) => m.role === "user").length;
  console.log(`\n  Session: ${chalk.cyan(state.sessionId)}  ·  ${turns} turns  ·  ${h.length} messages total\n`);
}

export async function ensureProviderConnected(state: ReplState): Promise<boolean> {
  if (state.providerConnected) return true;
  try {
    await retryTransientProviderOperation(
      () => state.provider.healthCheck?.(state.activeModel) ?? Promise.resolve(),
      { retries: 1 },
    );
    state.providerConnected = true;
    return true;
  } catch {
    return false;
  }
}

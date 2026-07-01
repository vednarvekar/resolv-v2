// apps/cli-direct/repl.ts
// Thin interactive REPL loop. Session setup, command dispatch, and
// provider/session helpers live in smaller modules.

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import chalk from "chalk";

import { completeCommand } from "../tui/slash-commands/registry.js";
import { AgentLoopLimitError } from "../../packages/core/errors.js";
import { isTransientProviderError } from "../../packages/providers/retry.js";
import { attachReplTranscript } from "./repl-transcript.js";
import { runLLMChatTurn } from "../../packages/llm/llm-calls.js";
import { printBanner } from "../tui/setup-wizard.js";
import { handleSlashCommand } from "./repl-commands.js";
import { createReplState } from "./repl-state.js";
import { ensureProviderConnected, persistCurrentSession, saveSessionIfNeeded } from "./repl-session.js";
import { printWelcome } from "./repl-ui.js";

export async function startRepl(resumeId?: string): Promise<void> {
  const state = await createReplState(resumeId);

  if (!state.isResuming) {
    printBanner();
    printWelcome(state.providerInfo.label, state.activeModel, state.sessionId);
  }

  attachReplTranscript(state.events);

  const rl = readline.createInterface({
    input,
    output,
    completer: (line: string) => completeCommand(line),
  });

  let closed = false;
  rl.on("close", () => {
    closed = true;
    persistCurrentSession(state);
  });

  while (!closed) {
    let rawLine: string;
    try {
      rawLine = await rl.question(chalk.cyan.bold("resolv > "));
    } catch {
      break;
    }

    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("/")) {
      await handleSlashCommand(line, state, rl, () => {
        closed = true;
      });
      continue;
    }

    if (!(await ensureProviderConnected(state))) {
      console.log(chalk.yellow("\n  Provider is currently disconnected. Use /provider to switch providers or /model to pick a different model.\n"));
      continue;
    }

    try {
      process.stdout.write("\n");
      rl.pause();
      try {
        await runLLMChatTurn(line, {
          provider: state.provider,
          tools: state.toolRegistry,
          session: state.session,
          events: state.events,
          model: state.config.model,
          maxToolCallRounds: state.appConfig.maxToolCallRounds,
        });
      } finally {
        rl.resume();
      }

      saveSessionIfNeeded(state);
    } catch (err) {
      if (err instanceof AgentLoopLimitError) {
        console.log(chalk.yellow(`Limit reached after ${state.appConfig.maxToolCallRounds} tool calls in one turn.`));
        console.log(chalk.yellow("The provider is still connected. Continue in the same session with a narrower follow-up if needed.\n"));
        continue;
      }
      if (isTransientProviderError(err)) {
        state.providerConnected = false;
      }
      console.log(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
      console.log(chalk.dim(
        isTransientProviderError(err)
          ? "  Please check /provider or /model before retrying.\n"
          : "  The provider is still connected; adjust the prompt or model and retry.\n"
      ));
    }
  }
}

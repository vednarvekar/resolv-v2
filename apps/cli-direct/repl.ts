// apps/cli-direct/repl.ts
// Main interactive REPL with session persistence, tab completion, and all commands.

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import fs from "node:fs";
import chalk from "chalk";

import { completeCommand } from "../tui/slash-commands/registry.js";
import { runConfigChangeCommand, runConfigCommand } from "./config-command.js";
import { runDnaCommand } from "./dna-command.js";
import { runProviderCommand, runModelCommand } from "./provider-command.js";
import { loadAppConfig, loadConfig, isConfigured, PROVIDER_INFO } from "../../config/config.js";
import { createProviderFromEnv } from "../../packages/providers/register.js";
import { printBanner } from "../tui/setup-wizard.js";
import { AgentSession } from "../../packages/orchestrator-agent/session.js";
import { runLLMChatTurn } from "../../packages/llm/llm-calls.js";
import { createLLMTools } from "../../packages/llm/tools/llm-tools.js";
import { ToolRegistry } from "../../packages/orchestrator-agent/tool-registry.js";
import { AgentEventBus } from "../../packages/core/events.js";
import { AgentLoopLimitError } from "../../packages/core/errors.js";
import { isTransientProviderError, retryTransientProviderOperation } from "../../packages/providers/retry.js";
import { attachReplTranscript } from "./repl-transcript.js";
import {
  saveSession,
  loadSession,
  listSessions,
  newSessionId,
} from "../../packages/llm/session/persistence.js";
import { parseCommand, printHelp, printWelcome } from "./repl-ui.js";

export async function startRepl(resumeId?: string): Promise<void> {
  let config = loadConfig();

  if (!isConfigured(config)) {
    console.log(chalk.yellow("\n  No provider configured. Run: resolv setup\n"));
    process.exit(1);
  }

  let providerInfo = PROVIDER_INFO[config.provider]!;
  let activeModel = config.model ?? providerInfo.defaultModel;
  let provider = createProviderFromEnv(config);
  let providerConnected = true;
  let appConfig = loadAppConfig();

  // Health check
  try {
    await retryTransientProviderOperation(
      () => provider.healthCheck?.(activeModel) ?? Promise.resolve(),
      { retries: 1 },
    );
  } catch (err) {
    providerConnected = false;
    const message = err instanceof Error ? err.message : String(err);
    console.log(chalk.yellow(`\n  Provider connection failed: ${message}`));
    console.log(chalk.dim("  You can still use /provider to switch providers, /model to select another model, or /help for commands.\n"));
  }

  // Session setup
  let sessionId = resumeId ?? newSessionId();
  let isResuming = Boolean(resumeId);
  const session = new AgentSession();
  session.setRepoPath(process.cwd());

  // Restore previous session if resuming
  if (resumeId) {
    const persisted = loadSession(resumeId);
    if (!persisted) {
      console.log(chalk.red(`\n  Session "${resumeId}" not found.\n`));
      sessionId = newSessionId();
      isResuming = false;
    } else {
      session.restoreHistory(persisted.history);
      console.log(chalk.green(`\n  Resumed session ${resumeId} (${persisted.history.length} messages)\n`));
    }
  }

  if (!isResuming) {
    printBanner();
    printWelcome(providerInfo.label, activeModel, sessionId);
  }

  const toolRegistry = new ToolRegistry();
  toolRegistry.registerAll(createLLMTools(process.cwd()));

  const events = new AgentEventBus();
  attachReplTranscript(events);

  const rl = readline.createInterface({
    input,
    output,
    completer: (line: string) => completeCommand(line),
  });

  let closed = false;

  const persistAndExit = () => {
    const history = [...session.getHistory()];
    if (history.length > 0) {
      saveSession(sessionId, history, config.provider, activeModel, process.cwd());
      console.log(chalk.dim(`\n  Session saved. Resume with: /resume ${sessionId}`));
      console.log(chalk.dim(`  Or: resolv --resume ${sessionId}\n`));
    } else {
      console.log(chalk.dim("\n  Goodbye.\n"));
    }
  };

  rl.on("close", () => {
    closed = true;
    persistAndExit();
  });

  const reactivateProvider = async (): Promise<void> => {
    try {
      const nextConfig = loadConfig();
      const nextInfo = PROVIDER_INFO[nextConfig.provider]!;
      const nextModel = nextConfig.model ?? nextInfo.defaultModel;
      const nextProvider = createProviderFromEnv(nextConfig);
      await retryTransientProviderOperation(
        () => nextProvider.healthCheck?.(nextModel) ?? Promise.resolve(),
        { retries: 1 },
      );
      config = nextConfig;
      appConfig = loadAppConfig();
      providerInfo = nextInfo;
      activeModel = nextModel;
      provider = nextProvider;
      providerConnected = true;
      console.log(chalk.green(`  ✓ Active: ${nextInfo.label} / ${nextModel}\n`));
    } catch (err) {
      providerConnected = false;
      console.log(chalk.red(`  Could not activate provider: ${err instanceof Error ? err.message : String(err)}\n`));
      console.log(chalk.dim("  Use /provider to choose a different provider or /model to update the active model.\n"));
    }
  };

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
      const { command, args } = parseCommand(line);

      switch (command) {
        case "/clear":
          process.stdout.write("\x1b[2J\x1b[H");
          printWelcome(providerInfo.label, activeModel, sessionId);
          break;

        case "/config":
          if (!args) {
            runConfigCommand();
          } else {
            try {
              rl.pause();
              const result = await runConfigChangeCommand(args);
              if (result.providerCredentialsChanged) await reactivateProvider();
            } finally {
              rl.resume();
            }
          }
          break;

        case "/config-change": {
          try {
            rl.pause();
            const result = await runConfigChangeCommand("change");
            if (result.providerCredentialsChanged) await reactivateProvider();
          } finally {
            rl.resume();
          }
          break;
        }

        case "/provider":
          try {
            rl.pause();
            await runProviderCommand(args);
            await reactivateProvider();
          } catch (err) {
            console.error(chalk.red(`\n  Error in /provider: ${err}\n`));
          } finally {
            rl.resume();
          }
          break;

        case "/model":
          try {
            rl.pause();
            await runModelCommand(args);
            await reactivateProvider();
          } catch (err) {
            console.error(chalk.red(`\n  Error in /model: ${err}\n`));
          } finally {
            rl.resume();
          }
          break;

        case "/dna": {
          const targetDir = path.join(process.cwd(), ".resolv");
          if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
          await runDnaCommand({ repoPath: process.cwd(), outputJson: path.join(targetDir, "analysis.json") });
          break;
        }

        case "/sessions": {
          const sessions = listSessions();
          if (sessions.length === 0) {
            console.log(chalk.dim("\n  No saved sessions.\n"));
          } else {
            console.log("");
            console.log(chalk.hex("#7c3aed").bold("  Recent sessions"));
            console.log(chalk.dim("  " + "─".repeat(52)));
            for (const s of sessions.slice(0, 10)) {
              const active = s.id === sessionId ? chalk.green(" ← current") : "";
              const when = new Date(s.updatedAt).toLocaleString();
              console.log(`  ${chalk.cyan(s.id)}  ${s.title.slice(0, 40).padEnd(40)}  ${chalk.dim(when)}${active}`);
            }
            console.log(chalk.dim("\n  Use /resume <id> to restore a session.\n"));
          }
          break;
        }

        case "/resume": {
          if (!args) {
            console.log(chalk.red("  Usage: /resume <session-id>\n"));
            break;
          }
          const persisted = loadSession(args);
          if (!persisted) {
            console.log(chalk.red(`  Session "${args}" not found. Use /sessions to list.\n`));
            break;
          }
          // Save current session first
          const currentHistory = [...session.getHistory()];
          if (currentHistory.length > 0) {
            saveSession(sessionId, currentHistory, config.provider, activeModel, process.cwd());
          }
          // Restore
          sessionId = args;
          session.restoreHistory(persisted.history);
          console.log(chalk.green(`  ✓ Resumed session ${args} (${persisted.history.length} messages)\n`));
          break;
        }

        case "/new": {
          const currentHistory = [...session.getHistory()];
          if (currentHistory.length > 0) {
            saveSession(sessionId, currentHistory, config.provider, activeModel, process.cwd());
            console.log(chalk.dim(`  Session ${sessionId} saved.\n`));
          }
          sessionId = newSessionId();
          session.clearHistory();
          session.setRepoPath(process.cwd());
          console.log(chalk.green(`  ✓ New session: ${sessionId}\n`));
          break;
        }

        case "/history": {
          const h = session.getHistory();
          const turns = h.filter((m) => m.role === "user").length;
          console.log(`\n  Session: ${chalk.cyan(sessionId)}  ·  ${turns} turns  ·  ${h.length} messages total\n`);
          break;
        }

        case "/help":
          printHelp();
          break;

        case "/exit":
        case "/quit":
          rl.close();
          return;

        default:
          console.log(chalk.red(`  Unknown command: ${command}`));
          console.log(chalk.dim("  Type /help to see available commands.\n"));
      }
      continue;
    }

    // Free text → LLM agent
    if (!providerConnected) {
      try {
        await retryTransientProviderOperation(
          () => provider.healthCheck?.(activeModel) ?? Promise.resolve(),
          { retries: 1 },
        );
        providerConnected = true;
      } catch {
        console.log(chalk.yellow("\n  Provider is currently disconnected. Use /provider to switch providers or /model to pick a different model.\n"));
        continue;
      }
    }

    try {
      process.stdout.write("\n");
      rl.pause();
      try {
        await runLLMChatTurn(line, {
          provider,
          tools: toolRegistry,
          session,
          events,
          model: config.model,
          maxToolCallRounds: appConfig.maxToolCallRounds,
        });
      } finally {
        rl.resume();
      }

      // Auto-save every 5 user turns
      const userMsgCount = session.getHistory().filter((m) => m.role === "user").length;
      if (userMsgCount % 5 === 0) {
        saveSession(sessionId, [...session.getHistory()], config.provider, activeModel, process.cwd());
      }
    } catch (err) {
      if (err instanceof AgentLoopLimitError) {
        console.log(chalk.yellow(`Limit reached after ${appConfig.maxToolCallRounds} tool calls in one turn.`));
        console.log(chalk.yellow("The provider is still connected. Continue in the same session with a narrower follow-up if needed.\n"));
        continue;
      }
      if (isTransientProviderError(err)) {
        providerConnected = false;
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

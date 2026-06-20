// apps/cli-direct/repl.ts
// Main interactive REPL with session persistence, tab completion, and all commands.

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import fs from "node:fs";
import chalk from "chalk";
import ora from "ora";

import { SLASH_COMMANDS, completeCommand } from "../tui/slash-commands/registry.js";
import { runConfigChangeCommand, runConfigCommand } from "./config-command.js";
import { runDnaCommand } from "./dna-command.js";
import { runProviderCommand, runModelCommand } from "./provider-command.js";
import { loadConfig, isConfigured, PROVIDER_INFO } from "../../config/config.js";
import { createProviderFromEnv } from "../../packages/providers/register.js";
import { AgentSession } from "../../packages/orchestrator-agent/session.js";
import { runLLMChatTurn } from "../../packages/llm/llm-calls.js";
import { createLLMTools } from "../../packages/llm/tools/llm-tools.js";
import { ToolRegistry } from "../../packages/orchestrator-agent/tool-registry.js";
import { AgentEventBus } from "../../packages/core/events.js";
import {
  saveSession,
  loadSession,
  listSessions,
  newSessionId,
} from "../../packages/llm/session/persistence.js";

function printWelcome(provider: string, model: string, sessionId: string) {
  console.log("");
  console.log(chalk.hex("#7c3aed").bold("  resolv") + chalk.dim(" — style-matching issue resolver"));
  console.log(chalk.dim(`  Provider: ${provider} · Model: ${model}`));
  console.log(chalk.dim(`  Session: ${chalk.white(sessionId)} · Type /help for commands`));
  console.log("");
}

function printHelp() {
  console.log("");
  console.log(chalk.hex("#7c3aed").bold("  Commands"));
  console.log(chalk.dim("  " + "─".repeat(52)));
  for (const cmd of SLASH_COMMANDS) {
    const name = chalk.cyan((cmd.usage ?? cmd.name).padEnd(30));
    console.log(`  ${name} ${chalk.dim(cmd.description)}`);
  }
  console.log("");
  console.log(chalk.dim("  Anything else is sent to the AI agent."));
  console.log(chalk.dim("  Set BRAVE_SEARCH_API_KEY for better web search (search_web tool)."));
  console.log("");
}

function parseCommand(line: string): { command: string; args: string } {
  const [command, ...rest] = line.split(" ");
  return { command: command ?? "", args: rest.join(" ").trim() };
}

export async function startRepl(resumeId?: string): Promise<void> {
  let config = loadConfig();

  if (!isConfigured(config)) {
    console.log(chalk.yellow("\n  No provider configured. Run: resolv setup\n"));
    process.exit(1);
  }

  let providerInfo = PROVIDER_INFO[config.provider]!;
  let activeModel = config.model ?? providerInfo.defaultModel;
  let provider = createProviderFromEnv(config);

  // Health check
  try {
    await provider.healthCheck?.(activeModel);
  } catch (err) {
    console.log(chalk.red(`\n  Provider error: ${err instanceof Error ? err.message : String(err)}\n`));
    return;
  }

  // Session setup
  let sessionId = resumeId ?? newSessionId();
  const session = new AgentSession();
  session.setRepoPath(process.cwd());

  // Restore previous session if resuming
  if (resumeId) {
    const persisted = loadSession(resumeId);
    if (!persisted) {
      console.log(chalk.red(`\n  Session "${resumeId}" not found.\n`));
      sessionId = newSessionId();
    } else {
      session.restoreHistory(persisted.history);
      console.log(chalk.green(`\n  Resumed session ${resumeId} (${persisted.history.length} messages)\n`));
    }
  }

  printWelcome(providerInfo.label, activeModel, sessionId);

  const toolRegistry = new ToolRegistry();
  toolRegistry.registerAll(createLLMTools(process.cwd()));

  const events = new AgentEventBus();
  let thinking: ReturnType<typeof ora> | undefined;

  const stopThinking = () => {
    if (thinking) { thinking.stop(); thinking = undefined; }
  };

  events.on((event) => {
    switch (event.type) {
      case "model_start":
        stopThinking();
        thinking = ora({ text: "Thinking...", color: "magenta", spinner: "dots" }).start();
        break;
      case "text_delta":
        stopThinking();
        process.stdout.write(event.text);
        break;
      case "tool_call_start":
        stopThinking();
        process.stdout.write(chalk.dim(`\n  ⚙  ${event.toolName}`));
        break;
      case "tool_call_end":
        if (event.isError) process.stdout.write(chalk.red(" ✗\n"));
        else process.stdout.write(chalk.dim(" ✓\n"));
        break;
      case "error":
        stopThinking();
        process.stdout.write(chalk.red(`\n  Error: ${event.message}\n`));
        break;
      case "turn_end":
        stopThinking();
        break;
    }
  });

  const promptStr = chalk.hex("#7c3aed").bold("resolv") + chalk.dim(" ❯ ");

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
      await nextProvider.healthCheck?.(nextModel);
      config = nextConfig;
      providerInfo = nextInfo;
      activeModel = nextModel;
      provider = nextProvider;
      console.log(chalk.green(`  ✓ Active: ${nextInfo.label} / ${nextModel}\n`));
    } catch (err) {
      console.log(chalk.red(`  Could not activate provider: ${err instanceof Error ? err.message : String(err)}\n`));
    }
  };

  while (!closed) {
    let rawLine: string;
    try {
      rawLine = await rl.question(promptStr);
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
            const result = await runConfigChangeCommand(args, rl);
            if (result.providerCredentialsChanged) await reactivateProvider();
          }
          break;

        case "/config-change": {
          const result = await runConfigChangeCommand("change", rl);
          if (result.providerCredentialsChanged) await reactivateProvider();
          break;
        }

        case "/provider":
          await runProviderCommand(args, rl);
          await reactivateProvider();
          break;

        case "/model":
          await runModelCommand(args, rl);
          await reactivateProvider();
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
              console.log(`  ${chalk.cyan(s.id)}  ${chalk.white(s.title.slice(0, 40).padEnd(40))}  ${chalk.dim(when)}${active}`);
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
    try {
      process.stdout.write("\n");
      await runLLMChatTurn(line, {
        provider,
        tools: toolRegistry,
        session,
        events,
        model: config.model,
      });
      process.stdout.write("\n\n");

      // Auto-save every 5 user turns
      const userMsgCount = session.getHistory().filter((m) => m.role === "user").length;
      if (userMsgCount % 5 === 0) {
        saveSession(sessionId, [...session.getHistory()], config.provider, activeModel, process.cwd());
      }
    } catch (err) {
      console.log(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
    }
  }
}
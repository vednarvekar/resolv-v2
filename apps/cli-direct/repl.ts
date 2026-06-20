// apps/cli-direct/repl.ts
// Main interactive REPL. Responsibilities:
// - Tab-complete slash commands
// - Route commands to handlers
// - Pass free-text to the LLM agent loop
// - Clean, informative UI without noise

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import fs from "node:fs";
import chalk from "chalk";

import { SLASH_COMMANDS, completeCommand } from "../tui/slash-commands/registry.js";
import { runConfigCommand } from "./config-command.js";
import { runDnaCommand } from "./dna-command.js";
import { runProviderCommand, runModelCommand } from "./provider-command.js";
import { loadConfig, isConfigured, PROVIDER_INFO } from "../../config/config.js";
import { createProviderFromEnv } from "../../packages/providers/register.js";
import { AgentSession } from "../../packages/orchestrator-agent/session.js";
import { runLLMChatTurn } from "../../packages/llm/llm-calls.js";
import { createLLMTools } from "../../packages/llm/llm-tools.js";
import { ToolRegistry } from "../../packages/orchestrator-agent/tool-registry.js";
import { AgentEventBus } from "../../packages/core/events.js";

function printWelcome(provider: string, model: string) {
  console.log("");
  console.log(chalk.hex("#7c3aed").bold("  resolv") + chalk.dim(" — style-matching issue resolver"));
  console.log(chalk.dim(`  Provider: ${provider} · Model: ${model}`));
  console.log(chalk.dim(`  Type / for commands, or ask anything about your codebase.`));
  console.log("");
}

function printHelp() {
  console.log("");
  console.log(chalk.hex("#7c3aed").bold("  Commands"));
  console.log(chalk.dim("  " + "─".repeat(48)));
  for (const cmd of SLASH_COMMANDS) {
    const name = chalk.cyan(cmd.name.padEnd(12));
    console.log(`  ${name} ${chalk.dim(cmd.description)}`);
    if (cmd.usage) console.log(`  ${"".padEnd(12)}   ${chalk.dim("Usage: " + cmd.usage)}`);
  }
  console.log("");
  console.log(chalk.dim("  Anything else is sent to the LLM agent."));
  console.log("");
}

function parseCommand(line: string): { command: string; args: string } {
  const [command, ...rest] = line.split(" ");
  return { command: command ?? "", args: rest.join(" ").trim() };
}

export async function startRepl(): Promise<void> {
  const config = loadConfig();

  if (!isConfigured(config)) {
    console.log(chalk.yellow("\n  No provider configured. Run: resolv setup\n"));
    process.exit(1);
  }

  const providerInfo = PROVIDER_INFO[config.provider]!;
  const activeModel = config.model ?? providerInfo.defaultModel;

  printWelcome(providerInfo.label, activeModel);

  // Wire up provider + agent infrastructure
  const provider = createProviderFromEnv(config);
  const session = new AgentSession();
  session.setRepoPath(process.cwd());

  const toolRegistry = new ToolRegistry();
  toolRegistry.registerAll(createLLMTools(process.cwd()));

  const events = new AgentEventBus();
  events.on((event) => {
    switch (event.type) {
      case "text_delta":
        process.stdout.write(event.text);
        break;
      case "tool_call_start":
        process.stdout.write(chalk.dim(`\n  ⚙  ${event.toolName}...\n`));
        break;
      case "tool_call_end":
        if (event.isError) process.stdout.write(chalk.red(`  ✗ Tool failed\n`));
        break;
      case "error":
        process.stdout.write(chalk.red(`\n  Error: ${event.message}\n`));
        break;
    }
  });

  const promptStr = chalk.hex("#7c3aed").bold("resolv") + chalk.dim(" ❯ ");

  const rl = readline.createInterface({
    input,
    output,
    prompt: promptStr,
    completer: (line: string) => completeCommand(line),
  });

  rl.on("close", () => {
    console.log(chalk.dim("\n  Goodbye.\n"));
    process.exit(0);
  });

  rl.prompt();

  for await (const rawLine of rl) {
    const line = rawLine.trim();

    if (!line) {
      rl.prompt();
      continue;
    }

    // Slash commands
    if (line.startsWith("/")) {
      const { command, args } = parseCommand(line);

      switch (command) {
        case "/clear":
          process.stdout.write("\x1b[2J\x1b[H");
          printWelcome(providerInfo.label, activeModel);
          break;

        case "/config":
          runConfigCommand();
          break;

        case "/help":
          printHelp();
          break;

        case "/dna": {
          const targetDir = path.join(process.cwd(), ".resolv");
          if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
          const outputPath = path.join(targetDir, "analysis.json");
          await runDnaCommand({ repoPath: process.cwd(), outputJson: outputPath });
          break;
        }

        case "/provider":
          await runProviderCommand(args);
          // Restart would be needed for full effect — inform user
          console.log(chalk.dim("  Note: restart resolv for the new provider to take effect.\n"));
          break;

        case "/model":
          await runModelCommand(args);
          console.log(chalk.dim("  Note: restart resolv for the new model to take effect.\n"));
          break;

        case "/exit":
        case "/quit":
          rl.close();
          return;

        default:
          console.log(chalk.red(`  Unknown command: ${command}`));
          console.log(chalk.dim("  Type /help to see available commands.\n"));
      }

      rl.prompt();
      continue;
    }

    // Free-text → LLM agent
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
    } catch (err) {
      console.log(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
    }

    rl.prompt();
  }
}
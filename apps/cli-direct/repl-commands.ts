import chalk from "chalk";
import path from "node:path";
import fs from "node:fs";
import type readline from "node:readline/promises";

import { runConfigChangeCommand, runConfigCommand } from "./config-command.js";
import { runDnaCommand } from "./dna-command.js";
import { runProviderCommand, runModelCommand } from "./provider-command.js";
import { printHelp, printWelcome, parseCommand } from "./repl-ui.js";
import type { ReplState } from "./repl-state.js";
import {
  printHistory,
  printSessions,
  reactivateProvider,
  resumeSession,
  startNewSession,
} from "./repl-session.js";

export async function handleSlashCommand(
  line: string,
  state: ReplState,
  rl: readline.Interface,
  onExit: () => void,
): Promise<void> {
  const { command, args } = parseCommand(line);

  switch (command) {
    case "/clear":
      process.stdout.write("\x1b[2J\x1b[H");
      printWelcome(state.providerInfo.label, state.activeModel, state.sessionId);
      break;

    case "/config":
      if (!args) {
        runConfigCommand();
      } else {
        try {
          rl.pause();
          const result = await runConfigChangeCommand(args);
          if (result.providerCredentialsChanged) await reactivateProvider(state);
        } finally {
          rl.resume();
        }
      }
      break;

    case "/config-change": {
      try {
        rl.pause();
        const result = await runConfigChangeCommand("change");
        if (result.providerCredentialsChanged) await reactivateProvider(state);
      } finally {
        rl.resume();
      }
      break;
    }

    case "/provider":
      try {
        rl.pause();
        await runProviderCommand(args);
        await reactivateProvider(state);
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
        await reactivateProvider(state);
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

    case "/sessions":
      printSessions(state);
      break;

    case "/resume":
      if (!args) {
        console.log(chalk.red("  Usage: /resume <session-id>\n"));
        break;
      }
      resumeSession(state, args);
      break;

    case "/new":
      startNewSession(state);
      break;

    case "/history":
      printHistory(state);
      break;

    case "/help":
      printHelp();
      break;

    case "/exit":
    case "/quit":
      rl.close();
      onExit();
      return;

    default:
      console.log(chalk.red(`  Unknown command: ${command}`));
      console.log(chalk.dim("  Type /help to see available commands.\n"));
  }
}

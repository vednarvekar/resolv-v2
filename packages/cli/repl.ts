// READ_EVAL_PRINT_LOOP

import readline from "node:readline";
import chalk from "chalk";

import { solve } from "./solve-command.js";
import { runDnaCommand } from "./dna-command.js";
import { runConfigCommand } from "./config-command.js";

const PROMPT = chalk.cyan("resolv") + chalk.dim(" › ");

function printBanner(): void {
  console.log("");
  console.log(chalk.bold.cyan("  resolv") + chalk.dim("  — in-context, style-matching issue resolver"));
  console.log(chalk.dim("  Type a command below. Type 'help' to see what's available, 'exit' to quit."));
  console.log("");
  console.log(chalk.dim("  Example:"));
  console.log(chalk.dim("    solve https://github.com/zulip/zulip/issues/123 --path ./zulip"));
  console.log("");
}

function printHelp(): void {
  console.log("");
  console.log(chalk.bold("Available commands"));
  console.log(chalk.dim("─".repeat(60)));
  console.log(`  ${chalk.yellow("solve <issue-url>")} ${chalk.dim("[--path <repo>] [--no-semantic]")}`);
  console.log(chalk.dim("      Fetch the issue, generate a style-matched fix, test it, open a PR."));
  console.log("");
  console.log(`  ${chalk.yellow("dna")} ${chalk.dim("[--path <repo>] [--json <file>]")}`);
  console.log(chalk.dim("      Inspect a repo's style DNA. No LLM or git calls."));
  console.log("");
  console.log(`  ${chalk.yellow("config")}`);
  console.log(chalk.dim("      Check whether required environment variables are set."));
  console.log("");
  console.log(`  ${chalk.yellow("clear")}`);
  console.log(chalk.dim("      Clear the terminal screen."));
  console.log("");
  console.log(`  ${chalk.yellow("help")}`);
  console.log(chalk.dim("      Show this message again."));
  console.log("");
  console.log(`  ${chalk.yellow("exit")} ${chalk.dim("(or 'quit', or Ctrl+D)")}`);
  console.log(chalk.dim("      Leave the resolv shell."));
  console.log("");
}

/**
 * Splits a line of input the way a shell would: respects quoted strings so
 * paths/titles with spaces work, e.g. solve <url> --path "./my repo".
 */
function tokenize(line: string): string[] {
  const tokens: string[] = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return tokens;
}

interface ParsedFlags {
  positional: string[];
  path?: string;
  json?: string;
  noSemantic: boolean;
}

function parseArgs(tokens: string[]): ParsedFlags {
  const positional: string[] = [];
  let path: string | undefined;
  let json: string | undefined;
  let noSemantic = false;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === "--path" || tok === "-p") {
      path = tokens[++i];
    } else if (tok === "--json") {
      json = tokens[++i];
    } else if (tok === "--no-semantic") {
      noSemantic = true;
    } else if (tok !== undefined) {
      positional.push(tok);
    }
  }

  return { positional, path, json, noSemantic };
}

async function dispatch(line: string): Promise<boolean> {
  const trimmed = line.trim();
  if (trimmed.length === 0) return true;

  const tokens = tokenize(trimmed);
  const command = tokens[0]?.toLowerCase();
  const rest = tokens.slice(1);

  switch (command) {
    case "exit":
    case "quit":
      return false;

    case "help":
    case "?":
      printHelp();
      return true;

    case "clear":
      console.clear();
      printBanner();
      return true;

    case "config":
      runConfigCommand();
      return true;

    case "dna": {
      const flags = parseArgs(rest);
      try {
        await runDnaCommand({
          repoPath: flags.path ?? process.cwd(),
          outputJson: flags.json,
        });
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      }
      return true;
    }

    case "solve": {
      const flags = parseArgs(rest);
      const issueUrl = flags.positional[0];
      if (!issueUrl) {
        console.error(chalk.red("Usage: solve <issue-url> [--path <repo>] [--no-semantic]"));
        return true;
      }
      try {
        await solve({
          issueUrl,
          repoPath: flags.path ?? process.cwd(),
          noSemantic: flags.noSemantic,
        });
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      }
      return true;
    }

    default:
      console.log(chalk.yellow(`Unknown command: "${command}". Type 'help' to see what's available.`));
      return true;
  }
}

/**
 * Starts the interactive shell. This is what runs when someone types just
 * `resolv` with no subcommand — a persistent session (codex/claude-code
 * style) instead of having to re-invoke the CLI for every action.
 */
export async function startRepl(): Promise<void> {
  printBanner();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: PROMPT,
    historySize: 200,
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const shouldContinue = await dispatch(line);
    if (!shouldContinue) {
      rl.close();
      return;
    }
    rl.prompt();
  });

  rl.on("close", () => {
    console.log(chalk.dim("\nGoodbye."));
    process.exit(0);
  });
}
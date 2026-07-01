import chalk from "chalk";

import { SLASH_COMMANDS } from "../tui/slash-commands/registry.js";

export function printWelcome(provider: string, model: string, sessionId: string): void {
  console.log("");
  console.log(chalk.bgHex("#7c3aed").white.bold("  Welcome to resolv  "));
  console.log(chalk.dim("  " + "─".repeat(62)));
  console.log(`  ${chalk.bold("Provider:")} ${chalk.bold(provider)}`);
  console.log(`  ${chalk.bold("Model:   ")} ${chalk.bold(model)}`);
  console.log(`  ${chalk.bold("Session: ")} ${chalk.cyan(sessionId)}`);
  const overrides: string[] = [];
  if (process.env.RESOLV_PROVIDER) overrides.push("RESOLV_PROVIDER");
  if (process.env.RESOLV_MODEL) overrides.push("RESOLV_MODEL");
  if (overrides.length > 0) {
    console.log(chalk.yellow(`  Note: ${overrides.join(" and ")} override saved configuration.`));
  }
  console.log(chalk.dim("  Type /help for commands"));
  console.log("");
}

export function printHelp(): void {
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

export function parseCommand(line: string): { command: string; args: string } {
  const [command, ...rest] = line.split(" ");
  return { command: command ?? "", args: rest.join(" ").trim() };
}

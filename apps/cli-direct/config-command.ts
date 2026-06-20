// apps/cli-direct/config-command.ts
// Prints a clean summary of the current resolv configuration.

import chalk from "chalk";
import {
  loadConfig,
  isConfigured,
  PROVIDER_INFO,
  getActiveApiKey,
} from "../../config/config.js";

export function runConfigCommand(): void {
  const config = loadConfig();
  const info = PROVIDER_INFO[config.provider]!;

  console.log("");
  console.log(chalk.hex("#7c3aed").bold("  resolv configuration"));
  console.log(chalk.dim("  " + "─".repeat(48)));
  console.log("");
  console.log(`  ${chalk.cyan("Provider:")}  ${chalk.bold(info.label)}`);
  console.log(`  ${chalk.cyan("Model:")}     ${chalk.bold(config.model ?? info.defaultModel)}`);

  if (config.provider !== "ollama") {
    const key = getActiveApiKey(config);
    const keyStatus = key
      ? chalk.green(`✓ set  ${chalk.dim("(ends in " + key.slice(-4) + ")")}`)
      : chalk.red("✗ missing");
    console.log(`  ${chalk.cyan("API Key:")}   ${keyStatus}`);
  } else {
    const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
    console.log(`  ${chalk.cyan("Ollama:")}    ${chalk.dim(baseUrl)}`);
  }

  const ghToken = config.githubToken;
  const ghStatus = ghToken
    ? chalk.green(`✓ set  ${chalk.dim("(ends in " + ghToken.slice(-4) + ")")}`)
    : chalk.dim("not set (PRs will stay local)");
  console.log(`  ${chalk.cyan("GitHub:")}    ${ghStatus}`);
  console.log(`  ${chalk.cyan("Tests:")}     ${chalk.dim(config.testCommand)}`);
  console.log(`  ${chalk.cyan("Max retries:")} ${chalk.dim(String(config.maxHealAttempts))}`);
  console.log("");

  if (!isConfigured(config)) {
    console.log(chalk.red("  ✗ Not ready — run /provider to set a provider and API key."));
  } else {
    console.log(chalk.green("  ✓ Ready"));
  }
  console.log("");
}
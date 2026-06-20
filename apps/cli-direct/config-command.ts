// apps/cli-direct/config-command.ts
// Prints a clean summary of the current resolv configuration.

import type readline from "node:readline/promises";
import chalk from "chalk";
import {
  loadConfig,
  isConfigured,
  PROVIDER_INFO,
  getActiveApiKey,
  saveConfig,
} from "../../config/config.js";

export interface ConfigChangeResult {
  providerCredentialsChanged: boolean;
}

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
    const info = PROVIDER_INFO[config.provider]!;
    if (info.keyEnv && process.env[info.keyEnv]) {
      console.log(chalk.yellow(`  Warning: ${info.keyEnv} is set and overrides the saved key.`));
    }
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

async function chooseSetting(rl: readline.Interface): Promise<string> {
  console.log("");
  console.log(`  ${chalk.cyan("1.")} API key for active provider`);
  console.log(`  ${chalk.cyan("2.")} GitHub token`);
  console.log(`  ${chalk.cyan("3.")} Test command`);
  console.log(`  ${chalk.cyan("4.")} Maximum retry count`);
  return rl.question(chalk.hex("#7c3aed")("  Select [1-4]: "));
}

export async function runConfigChangeCommand(
  args: string,
  rl: readline.Interface
): Promise<ConfigChangeResult> {
  const config = loadConfig();
  const info = PROVIDER_INFO[config.provider]!;
  let setting = args.trim().toLowerCase();

  if (!setting || setting === "change" || setting === "chnage") setting = await chooseSetting(rl);
  const providerCredentialsChanged = setting === "key" || setting === "api-key" || setting === "1";

  if (providerCredentialsChanged) {
    if (config.provider === "ollama") {
      console.log(chalk.yellow("\n  Ollama does not use an API key. Configure OLLAMA_BASE_URL in .env instead.\n"));
      return { providerCredentialsChanged: false };
    }

    const key = (await rl.question(chalk.hex("#7c3aed")(`  New ${info.keyLabel}: `))).trim();
    if (key.length <= 10) {
      console.log(chalk.red("  Key looks too short; configuration was not changed.\n"));
      return { providerCredentialsChanged: false };
    }
    config.apiKeys[config.provider] = key;
    saveConfig(config);
    console.log(chalk.green(`  ✓ ${info.keyLabel} updated (ends in ${key.slice(-4)}).`));
    if (info.keyEnv && process.env[info.keyEnv]) {
      console.log(chalk.yellow(
        `  Warning: ${info.keyEnv} is set and overrides the saved key. Update or remove it from your environment or .env.`
      ));
    }
    console.log("");
    return { providerCredentialsChanged: true };
  }

  if (setting === "github" || setting === "github-token" || setting === "2") {
    const token = (await rl.question(chalk.hex("#7c3aed")("  New GitHub token (leave blank to remove): "))).trim();
    config.githubToken = token || undefined;
    saveConfig(config);
    console.log(chalk.green(`  ✓ GitHub token ${token ? `updated (ends in ${token.slice(-4)})` : "removed"}.\n`));
    if (process.env.GITHUB_TOKEN) {
      console.log(chalk.yellow("  Warning: GITHUB_TOKEN overrides the saved value. Update or remove it from your environment or .env.\n"));
    }
    return { providerCredentialsChanged: false };
  }

  if (setting === "test" || setting === "test-command" || setting === "3") {
    const command = (await rl.question(chalk.hex("#7c3aed")(`  Test command [${config.testCommand}]: `))).trim();
    if (command) config.testCommand = command;
    saveConfig(config);
    console.log(chalk.green(`  ✓ Test command: ${config.testCommand}\n`));
    return { providerCredentialsChanged: false };
  }

  if (setting === "retries" || setting === "max-retries" || setting === "4") {
    const answer = await rl.question(chalk.hex("#7c3aed")(`  Maximum retries [${config.maxHealAttempts}]: `));
    const retries = Number.parseInt(answer.trim(), 10);
    if (!Number.isInteger(retries) || retries < 1 || retries > 20) {
      console.log(chalk.red("  Enter a whole number from 1 to 20; configuration was not changed.\n"));
      return { providerCredentialsChanged: false };
    }
    config.maxHealAttempts = retries;
    saveConfig(config);
    console.log(chalk.green(`  ✓ Maximum retries: ${retries}\n`));
    return { providerCredentialsChanged: false };
  }

  console.log(chalk.red("  Unknown setting. Use /config change, key, github, test, or retries.\n"));
  return { providerCredentialsChanged: false };
}

// apps/cli-direct/config-command.ts
// Prints a clean summary of the current resolv configuration.

import inquirer from "inquirer";
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
  console.log("");

  if (!isConfigured(config)) {
    console.log(chalk.red("  ✗ Not ready — run /provider to set a provider and API key."));
  } else {
    console.log(chalk.green("  ✓ Ready"));
  }
  console.log("");
}

async function chooseSetting(): Promise<string> {
  console.log("");
  const { choice } = await inquirer.prompt([
    {
      type: "select",
      name: "choice",
      message: "Select a setting to change:",
      choices: [
        { name: "API key for active provider", value: "1" },
        { name: "GitHub token", value: "2" },
      ],
    },
  ]);
  return choice;
}

export async function runConfigChangeCommand(args: string): Promise<ConfigChangeResult> {
  const config = loadConfig();
  const info = PROVIDER_INFO[config.provider]!;
  let setting = args.trim().toLowerCase();

  if (!setting || setting === "change" || setting === "chnage") setting = await chooseSetting();
  const providerCredentialsChanged = setting === "key" || setting === "api-key" || setting === "1";

  if (providerCredentialsChanged) {
    if (config.provider === "ollama") {
      console.log(chalk.yellow("\n  Ollama does not use an API key. Configure OLLAMA_BASE_URL in .env instead.\n"));
      return { providerCredentialsChanged: false };
    }

    while (true) {
      const { key } = await inquirer.prompt([{
        type: "password",
        name: "key",
        message: `  New ${info.keyLabel}:`,
        mask: "*",
      }]);
      if (key.trim().length > 10) {
        config.apiKeys[config.provider] = key.trim();
        saveConfig(config);
        console.log(chalk.green(`  ✓ ${info.keyLabel} updated (ends in ${key.trim().slice(-4)}).`));
        break;
      }
      console.log(chalk.red("  Key looks too short — try again."));
    }
    if (info.keyEnv && process.env[info.keyEnv]) {
      console.log(chalk.yellow(
        `  Warning: ${info.keyEnv} is set and overrides the saved key. Update or remove it from your environment or .env.`
      ));
    }
    console.log("");
    return { providerCredentialsChanged: true };
  }

  if (setting === "github" || setting === "github-token" || setting === "2") {
    const { token } = await inquirer.prompt([{
      type: "input",
      name: "token",
      message: "  New GitHub token (leave blank to remove):",
    }]);
    config.githubToken = token.trim() || undefined;
    saveConfig(config);
    console.log(chalk.green(`  ✓ GitHub token ${token.trim() ? `updated (ends in ${token.trim().slice(-4)})` : "removed"}.\n`));
    if (process.env.GITHUB_TOKEN) {
      console.log(chalk.yellow("  Warning: GITHUB_TOKEN overrides the saved value. Update or remove it from your environment or .env.\n"));
    }
    return { providerCredentialsChanged: false };
  }

  console.log(chalk.red("  Unknown setting."));
  console.log(chalk.dim("  Try: /config | /config change | /config key | /config github\n"));
  return { providerCredentialsChanged: false };
}

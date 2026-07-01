import chalk from "chalk";
// /provider and /model commands — let users switch providers and models
// from inside the REPL without editing env files.

import inquirer from "inquirer";
import {
  type ResolvConfig,
  PROVIDER_INFO,
  loadConfig,
  saveConfig,
} from "../../config/config.js";
import { chooseModelName, chooseProvider } from "./provider-workflow.js";

export async function runProviderCommand(args: string): Promise<void> {
  const config = loadConfig();
  const provider = await chooseProvider(args);

  const info = PROVIDER_INFO[provider]!;
  console.log(`\n  ${chalk.green("✓")} ${chalk.bold(info.label)}`);

  config.provider = provider;

  // Collect API key if needed and not already set
  if (provider !== "ollama" && !config.apiKeys[provider]) {
    console.log(chalk.dim(`\n  ${info.description}`));
    while (true) {
      const { key } = await inquirer.prompt([{
        type: 'password',
        name: 'key',
        message: `  Enter ${info.keyLabel}: `,
        mask: '*',
      }]);
      if (key.trim().length > 10) {
        config.apiKeys[provider] = key.trim();
        saveConfig(config);
        console.log(chalk.green("  ✓ API key saved."));
        break;
      }
      console.log(chalk.red("  Key looks too short — try again."));
    }
  } else if (provider !== "ollama") {
    const existing = config.apiKeys[provider]!;
    const { update } = await inquirer.prompt([{
      type: 'confirm',
      name: 'update',
      message: `  Key already set (ends in ${existing.slice(-4)}). Update?`,
      default: false,
      }]);

    if (update) {
      while (true) {
        const { key } = await inquirer.prompt([{
          type: 'password',
          name: 'key',
          message: `  New ${info.keyLabel}: `,
          mask: '*',
        }]);
        if (key.trim().length > 10) { 
          config.apiKeys[provider] = key.trim();
          saveConfig(config);
          console.log(chalk.green("  ✓ API key saved.")); 
          break; 
        }
        console.log(chalk.red("  Key looks too short."));
      }
    }
  }

  // Model selection
  console.log("\n  Select model:\n");
  const model = await chooseModelName(info, config);
  config.model = model;

  saveConfig(config as ResolvConfig);
  console.log(`\n  ${chalk.green("✓")} Switched to ${chalk.bold(info.label)} / ${chalk.bold(model)}`);
  if (process.env.RESOLV_PROVIDER && process.env.RESOLV_PROVIDER !== provider) {
    console.log(chalk.yellow(
      `  Warning: RESOLV_PROVIDER=${process.env.RESOLV_PROVIDER} overrides this saved provider. Remove it from your environment or .env.`
    ));
  }
  if (process.env.RESOLV_MODEL && process.env.RESOLV_MODEL !== model) {
    console.log(chalk.yellow(
      `  Warning: RESOLV_MODEL=${process.env.RESOLV_MODEL} overrides this saved model. Remove it from your environment or .env.`
    ));
  }
  console.log(chalk.dim("  Config saved.\n"));
}

export async function runModelCommand(args: string): Promise<void> {
  const config = loadConfig();
  const info = PROVIDER_INFO[config.provider]!;

  // If model name passed directly, use it
  if (args.trim()) {
    config.model = args.trim();
    saveConfig(config as ResolvConfig);
    console.log(`\n  ${chalk.green("✓")} Model set to ${chalk.bold(args.trim())}\n`);
    if (process.env.RESOLV_MODEL && process.env.RESOLV_MODEL !== args.trim()) {
      console.log(chalk.yellow(
        `  Warning: RESOLV_MODEL=${process.env.RESOLV_MODEL} overrides this saved model. Remove it from your environment or .env.\n`
      ));
    }
    return;
  }

  console.log(`\n  Provider: ${chalk.bold(info.label)} — pick a model:\n`);
  const model = await chooseModelName(info, config);
  config.model = model;
  saveConfig(config as ResolvConfig);
  console.log(`\n  ${chalk.green("✓")} Model set to ${chalk.bold(model)}\n`);
  if (process.env.RESOLV_MODEL && process.env.RESOLV_MODEL !== model) {
    console.log(chalk.yellow(
      `  Warning: RESOLV_MODEL=${process.env.RESOLV_MODEL} overrides this saved model. Remove it from your environment or .env.\n`
    ));
  }
}

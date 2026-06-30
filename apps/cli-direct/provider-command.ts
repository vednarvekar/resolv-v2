// apps/cli-direct/provider-command.ts
// /provider and /model commands — let users switch providers and models
// from inside the REPL without editing env files.

import inquirer from "inquirer";
import chalk from "chalk";
import { createProviderFromEnv } from "../../packages/providers/register.js";
import type { Provider } from "../../packages/providers/provider.js";
import {
  type ProviderName,
  type ResolvConfig,
  PROVIDER_INFO,
  loadConfig,
  saveConfig,
} from "../../config/config.js";

const PROVIDERS: ProviderName[] = ["anthropic", "google", "nim", "ollama", "grok", "openai", "openrouter"];

async function selectFromList<T extends string>(
  items: T[],
  label: (item: T) => string,
  promptLabel = "Select"
): Promise<T> {
  const { choice } = await inquirer.prompt([
    {
      type: 'select',
      name: 'choice',
      message: promptLabel,
      choices: items.map(item => ({ name: label(item), value: item })),
    }
  ]);
  return choice;
}

const modelCache = new Map<string, string[]>();

async function tryFetchModelList(config: ResolvConfig): Promise<string[] | undefined> {
  const cacheKey = `${config.provider}:${JSON.stringify(config.apiKeys[config.provider] ?? "")}`;
  if (modelCache.has(cacheKey)) {
    return modelCache.get(cacheKey);
  }

  const provider = createProviderFromEnv(config);
  if (typeof provider.listModels !== "function") {
    return undefined;
  }

  let lastError = "";

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const models = await provider.listModels();

      if (models.length > 0) {
        modelCache.set(cacheKey, models);
        return models;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);

      if (attempt < 3) {
        console.log(chalk.yellow(`  Couldn't reach provider. Retrying... (${attempt}/3)`));
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }

  console.log(chalk.yellow(`  Could not fetch provider model list: ${lastError}`));
  return undefined;
}

async function chooseModel(
  info: typeof PROVIDER_INFO[keyof typeof PROVIDER_INFO],
  config: ResolvConfig
): Promise<string> {
  const remoteModels = await tryFetchModelList(config);
  if (remoteModels?.length) {
    console.log(chalk.dim("\n  Fetched available models from provider. Use the arrow keys to select one."));
    return await selectFromList(remoteModels, (m) => m, "Choose model:");
  }

  console.log(chalk.yellow("  Could not fetch models interactively. Please enter model name manually."));
  const { custom } = await inquirer.prompt([{
    type: 'input',
    name: 'custom',
    message: `  Enter model name [${info.defaultModel}]: `,
  }]);
  return custom.trim() || info.defaultModel;
}

export async function runProviderCommand(args: string): Promise<void> {
  const config = loadConfig();
  const targetProvider = args.trim() as ProviderName | "";

  let provider: ProviderName;

  if (targetProvider && PROVIDERS.includes(targetProvider as ProviderName)) {
    provider = targetProvider as ProviderName;
  } else {
    console.log("\n  Select provider:\n");
    provider = await selectFromList(PROVIDERS, (name) => {
      const info = PROVIDER_INFO[name]!;
      return `${info.label} ${chalk.dim(info.description)}`;
    }, "Choose provider:");
  }

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
  const model = await chooseModel(info, config);
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
  const model = await chooseModel(info, config);
  config.model = model;
  saveConfig(config as ResolvConfig);
  console.log(`\n  ${chalk.green("✓")} Model set to ${chalk.bold(model)}\n`);
  if (process.env.RESOLV_MODEL && process.env.RESOLV_MODEL !== model) {
    console.log(chalk.yellow(
      `  Warning: RESOLV_MODEL=${process.env.RESOLV_MODEL} overrides this saved model. Remove it from your environment or .env.\n`
    ));
  }
}

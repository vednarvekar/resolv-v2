// apps/cli-direct/provider-command.ts
// /provider and /model commands — let users switch providers and models
// from inside the REPL without editing env files.

import readline from "node:readline/promises";
import chalk from "chalk";
import {
  type ProviderName,
  type ResolvConfig,
  PROVIDER_INFO,
  loadConfig,
  saveConfig,
} from "../../config/config.js";

const PROVIDERS: ProviderName[] = ["anthropic", "google", "nim", "ollama", "grok", "openai", "openrouter"];

async function selectNumbered<T extends string>(
  rl: readline.Interface,
  items: T[],
  label: (item: T) => string
): Promise<T> {
  items.forEach((item, index) => console.log(`  ${chalk.cyan(`${index + 1}.`)} ${label(item)}`));
  while (true) {
    const answer = await rl.question(chalk.hex("#7c3aed")(`  Select [1-${items.length}]: `));
    const index = Number.parseInt(answer.trim(), 10) - 1;
    if (Number.isInteger(index) && index >= 0 && index < items.length) return items[index]!;
    console.log(chalk.red(`  Enter a number from 1 to ${items.length}.`));
  }
}

export async function runProviderCommand(args: string, rl: readline.Interface): Promise<void> {
  const config = loadConfig();
  const targetProvider = args.trim() as ProviderName | "";

  let provider: ProviderName;

  if (targetProvider && PROVIDERS.includes(targetProvider as ProviderName)) {
    provider = targetProvider as ProviderName;
  } else {
    console.log("\n  Select provider:\n");
    provider = await selectNumbered(rl, PROVIDERS, (name) => {
      const info = PROVIDER_INFO[name]!;
      return `${info.label}  ${chalk.dim(info.description)}`;
    });
  }

  const info = PROVIDER_INFO[provider]!;
  console.log(`\n  ${chalk.green("✓")} ${chalk.bold(info.label)}`);

  config.provider = provider;

  // Collect API key if needed and not already set
  if (provider !== "ollama" && !config.apiKeys[provider]) {
    console.log(chalk.dim(`\n  ${info.description}`));
    while (true) {
      const key = await rl.question(chalk.hex("#7c3aed")(`  Enter ${info.keyLabel}: `));
      if (key.trim().length > 10) {
        config.apiKeys[provider] = key.trim();
        break;
      }
      console.log(chalk.red("  Key looks too short — try again."));
    }
  } else if (provider !== "ollama") {
    const existing = config.apiKeys[provider]!;
    const update = await rl.question(
      chalk.dim(`  Key already set (ends in ${existing.slice(-4)}). Update? (y/N): `)
    );
    if (update.trim().toLowerCase() === "y") {
      while (true) {
        const key = await rl.question(chalk.hex("#7c3aed")(`  New ${info.keyLabel}: `));
        if (key.trim().length > 10) { config.apiKeys[provider] = key.trim(); break; }
        console.log(chalk.red("  Key looks too short."));
      }
    }
  }

  // Model selection
  console.log("\n  Select model:\n");
  const model = await selectNumbered(rl, info.models, (name) => name);
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

export async function runModelCommand(args: string, rl: readline.Interface): Promise<void> {
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
  const model = await selectNumbered(rl, info.models, (name) => name);
  config.model = model;
  saveConfig(config as ResolvConfig);
  console.log(`\n  ${chalk.green("✓")} Model set to ${chalk.bold(model)}\n`);
  if (process.env.RESOLV_MODEL && process.env.RESOLV_MODEL !== model) {
    console.log(chalk.yellow(
      `  Warning: RESOLV_MODEL=${process.env.RESOLV_MODEL} overrides this saved model. Remove it from your environment or .env.\n`
    ));
  }
}

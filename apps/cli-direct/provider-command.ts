// apps/cli-direct/provider-command.ts
// /provider and /model commands — let users switch providers and models
// from inside the REPL without editing env files.

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import chalk from "chalk";
import {
  type ProviderName,
  type ResolvConfig,
  PROVIDER_INFO,
  loadConfig,
  saveConfig,
  isConfigured,
} from "../../config/config.js";

const PROVIDERS: ProviderName[] = ["anthropic", "google", "nim", "ollama"];

// ── Raw mode arrow-key selection (reused from setup wizard) ──
const clearLine = () => process.stdout.write("\r\x1b[K");
const moveCursor = (n: number) => process.stdout.write(`\x1b[${Math.abs(n)}${n < 0 ? "A" : "B"}`);
const hideCursor = () => process.stdout.write("\x1b[?25l");
const showCursor = () => process.stdout.write("\x1b[?25h");

async function arrowSelect<T extends string>(items: T[], renderFn: (items: T[], sel: number) => void): Promise<T> {
  hideCursor();
  let sel = 0;
  renderFn(items, sel);

  return new Promise((resolve) => {
    const onKey = (key: Buffer) => {
      const str = key.toString();
      if (str === "\x1b[A" && sel > 0) { moveCursor(-items.length); sel--; renderFn(items, sel); }
      else if (str === "\x1b[B" && sel < items.length - 1) { moveCursor(-items.length); sel++; renderFn(items, sel); }
      else if (str === "\r" || str === "\n") {
        showCursor();
        process.stdin.setRawMode(false);
        process.stdin.removeListener("data", onKey);
        process.stdin.pause();
        resolve(items[sel]!);
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onKey);
  });
}

function renderProviders(providers: ProviderName[], sel: number) {
  for (let i = 0; i < providers.length; i++) {
    const info = PROVIDER_INFO[providers[i]!]!;
    clearLine();
    process.stdout.write(
      i === sel
        ? `  ${chalk.bgHex("#7c3aed").white.bold(` ❯ ${info.label} `)}  ${chalk.dim(info.description)}\n`
        : `    ${chalk.white(info.label)}  ${chalk.dim(info.description)}\n`
    );
  }
}

function renderModels(models: string[], sel: number) {
  for (let i = 0; i < models.length; i++) {
    clearLine();
    process.stdout.write(
      i === sel
        ? `  ${chalk.bgHex("#7c3aed").white.bold(` ❯ ${models[i]} `)}\n`
        : `    ${chalk.white(models[i])}\n`
    );
  }
}

export async function runProviderCommand(args: string): Promise<void> {
  const rl = readline.createInterface({ input, output });
  const config = loadConfig();
  const targetProvider = args.trim() as ProviderName | "";

  let provider: ProviderName;

  if (targetProvider && PROVIDERS.includes(targetProvider as ProviderName)) {
    provider = targetProvider as ProviderName;
  } else {
    console.log("\n  Select provider:\n");
    provider = await arrowSelect(PROVIDERS, renderProviders);
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
  const model = await arrowSelect(info.models, renderModels);
  config.model = model;

  saveConfig(config as ResolvConfig);
  console.log(`\n  ${chalk.green("✓")} Switched to ${chalk.bold(info.label)} / ${chalk.bold(model)}`);
  console.log(chalk.dim("  Config saved. Restart the session to apply changes.\n"));

  rl.close();
}

export async function runModelCommand(args: string): Promise<void> {
  const config = loadConfig();
  const info = PROVIDER_INFO[config.provider]!;

  // If model name passed directly, use it
  if (args.trim()) {
    config.model = args.trim();
    saveConfig(config as ResolvConfig);
    console.log(`\n  ${chalk.green("✓")} Model set to ${chalk.bold(args.trim())}\n`);
    return;
  }

  console.log(`\n  Provider: ${chalk.bold(info.label)} — pick a model:\n`);
  const model = await arrowSelect(info.models, renderModels);
  config.model = model;
  saveConfig(config as ResolvConfig);
  console.log(`\n  ${chalk.green("✓")} Model set to ${chalk.bold(model)}\n`);
}
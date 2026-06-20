// apps/cli-direct/provider-command.ts
// /provider and /model commands — let users switch providers and models
// from inside the REPL without editing env files.

import * as readline from "node:readline/promises";
import * as nodeReadline from "node:readline";
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

function moveCursorUp(lines: number): void {
  if (lines > 0) process.stdout.write(`\x1b[${lines}A`);
}

function clearLine(): void {
  process.stdout.write("\x1b[2K");
}

async function selectFromList<T extends string>(
  items: T[],
  label: (item: T) => string,
  promptLabel = "Select"
): Promise<T> {
  if (!process.stdin.isTTY) throw new Error("Interactive selection requires a TTY.");

  let selected = 0;
  let pageStart = 0;
  const pageSize = Math.min(12, items.length);
  let renderedLines = 0;

  const draw = () => {
    if (renderedLines) moveCursorUp(renderedLines);
    const pageEnd = Math.min(items.length, pageStart + pageSize);
    const lines: string[] = [];
    lines.push(chalk.dim(`  ${promptLabel} ${pageStart + 1}-${pageEnd} of ${items.length}. Use ↑/↓ and Enter.`));
    for (let index = pageStart; index < pageEnd; index++) {
      const prefix = index === selected ? chalk.hex("#7c3aed").white(" > ") : "   ";
      const labelText = label(items[index]!);
      const line = index === selected
        ? `${prefix}${chalk.hex("#7c3aed").white(labelText)}`
        : `${prefix}${chalk.white(labelText)}`;
      lines.push(line);
    }
    lines.push(chalk.dim("  Esc to cancel."));
    process.stdout.write(lines.map((line) => `\x1b[2K${line}`).join("\n") + "\n");
    renderedLines = lines.length;
  };

  return new Promise((resolve, reject) => {
    const onKey = (chunk: Buffer) => {
      const str = chunk.toString("utf8");
      if (str === "\u0003" || str === "\x1b") {
        cleanup();
        reject(new Error("Selection cancelled."));
        return;
      }
      if (str === "\r" || str === "\n") {
        cleanup();
        resolve(items[selected]!);
        return;
      }
      const up = str.includes("\x1b[A");
      const down = str.includes("\x1b[B");
      if (!up && !down) return;
      if (up && selected > 0) selected -= 1;
      if (down && selected < items.length - 1) selected += 1;
      if (selected < pageStart) pageStart = selected;
      if (selected >= pageStart + pageSize) pageStart = selected - pageSize + 1;
      draw();
    };

    const cleanup = () => {
      process.stdin.off("data", onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      if (renderedLines) moveCursorUp(renderedLines);
      for (let i = 0; i < renderedLines; i++) {
        clearLine();
        if (i < renderedLines - 1) process.stdout.write("\n");
      }
      if (renderedLines) process.stdout.write("\n");
    };

    nodeReadline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onKey);
    draw();
  });
}

async function tryFetchModelList(config: ResolvConfig): Promise<string[] | undefined> {
  try {
    const provider = createProviderFromEnv(config);
    if (typeof provider.listModels !== "function") return undefined;
    const models = await provider.listModels();
    return models.length > 0 ? models : undefined;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(chalk.yellow(`  Could not fetch provider model list: ${message}`));
    return undefined;
  }
}

async function chooseModel(
  rl: readline.Interface,
  info: typeof PROVIDER_INFO[keyof typeof PROVIDER_INFO],
  config: ResolvConfig
): Promise<string> {
  const remoteModels = await tryFetchModelList(config);
  if (remoteModels?.length) {
    console.log(chalk.dim("\n  Fetched available models from provider. Use the arrow keys to select one."));
    return await selectFromList(remoteModels, (m) => m, "Choose model:");
  }

  const options = [...info.models, "Custom model..."];
  console.log("");
  options.forEach((item, index) => console.log(`  ${chalk.cyan(`${index + 1}.`)} ${item}`));

  while (true) {
    const answer = await rl.question(chalk.hex("#7c3aed")(`  Select [1-${options.length}]: `));
    const index = Number.parseInt(answer.trim(), 10) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= options.length) {
      console.log(chalk.red(`  Enter a number from 1 to ${options.length}.`));
      continue;
    }

    if (index === options.length - 1) {
      const custom = await rl.question(chalk.hex("#7c3aed")("  Enter custom model name: "));
      if (custom.trim()) return custom.trim();
      console.log(chalk.red("  Model name cannot be empty."));
      continue;
    }

    return options[index]!;
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
  const model = await chooseModel(rl, info, config);
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
  const model = await chooseModel(rl, info, config);
  config.model = model;
  saveConfig(config as ResolvConfig);
  console.log(`\n  ${chalk.green("✓")} Model set to ${chalk.bold(model)}\n`);
  if (process.env.RESOLV_MODEL && process.env.RESOLV_MODEL !== model) {
    console.log(chalk.yellow(
      `  Warning: RESOLV_MODEL=${process.env.RESOLV_MODEL} overrides this saved model. Remove it from your environment or .env.\n`
    ));
  }
}

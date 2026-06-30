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
  promptLabel = "Select",
  rl?: readline.Interface
): Promise<T> {
  if (!rl) throw new Error("Interactive selection requires readline interface.");

  const rlInput = (rl as any).input;
  rl.pause();
  rlInput.setRawMode(true);
  rlInput.resume();

  let selected = 0;
  let pageStart = 0;
  const pageSize = Math.min(12, items.length);
  let renderedLines = 0;

  const draw = () => {
    if (renderedLines > 0) {
      moveCursorUp(renderedLines);
      // Clear all lines
      for (let i = 0; i < renderedLines; i++) {
        process.stdout.write("\x1b[2K\n");
      }
      moveCursorUp(renderedLines);
    }

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
    const onKey = (_: any, key: { name?: string, ctrl?: boolean, meta?: boolean, shift?: boolean }) => {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        reject(new Error("Selection cancelled."));
        return;
      }
      if (key.name === 'escape') {
        cleanup();
        reject(new Error("Selection cancelled."));
        return;
      }
      if (key.name === 'return') {
        cleanup();
        resolve(items[selected]!);
        return;
      }
      if (key.name === 'up' && selected > 0) selected -= 1;
      if (key.name === 'down' && selected < items.length - 1) selected += 1;
      if (selected < pageStart) pageStart = selected;
      if (selected >= pageStart + pageSize) pageStart = selected - pageSize + 1;
      draw();
    };

    const cleanup = () => {
      rlInput.removeListener("keypress", onKey);
      rlInput.setRawMode(false);
      rl.resume();
      if (renderedLines > 0) {
        moveCursorUp(renderedLines);
        for (let i = 0; i < renderedLines; i++) {
          process.stdout.write("\x1b[2K\n");
        }
        moveCursorUp(renderedLines);
      }
    };

    nodeReadline.emitKeypressEvents(rlInput);
    rlInput.on("keypress", onKey);
    draw();
  });
}

async function tryFetchModelList(config: ResolvConfig): Promise<string[] | undefined> {
  let lastError = "";

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const provider = createProviderFromEnv(config);

      if (typeof provider.listModels !== "function") {
        return undefined;
      }

      const models = await provider.listModels();

      if (models.length > 0) {
        return models;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);

      if (attempt < 3) {
        console.log(
          chalk.yellow(
            `  Failed to fetch models (attempt ${attempt}/3). Retrying...`
          )
        );

        await new Promise((r) =>
          setTimeout(r, 1000 * attempt)
        );
      }
    }
  }

  console.log(
    chalk.yellow(
      `  Could not fetch provider model list: ${lastError}`
    )
  );

  return undefined;
}

async function chooseModel(
  rl: readline.Interface,
  info: typeof PROVIDER_INFO[keyof typeof PROVIDER_INFO],
  config: ResolvConfig
): Promise<string> {
  const remoteModels = await tryFetchModelList(config);
  if (remoteModels?.length) {
    console.log(chalk.dim("\n  Fetched available models from provider. Use the arrow keys to select one."));
    const model = await selectFromList(remoteModels, (m) => m, "Choose model:", rl);
    return model;
  }

  console.log(chalk.yellow("  Could not fetch models interactively. Please enter model name manually."));
  const custom = await rl.question(chalk.hex("#7c3aed")(`  Enter model name [${info.defaultModel}]: `))
  process.stdout.write("\x1b[1A");
  process.stdout.write("\x1b[2K\r");;
  return custom.trim() || info.defaultModel;
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
    }, "Choose provider:", rl);
  }

  const info = PROVIDER_INFO[provider]!;
  console.log(`\n  ${chalk.green("✓")} ${chalk.bold(info.label)}`);

  config.provider = provider;

  // Collect API key if needed and not already set
  if (provider !== "ollama" && !config.apiKeys[provider]) {
    console.log(chalk.dim(`\n  ${info.description}`));
    while (true) {
      const key = await rl.question(chalk.hex("#7c3aed")(`  Enter ${info.keyLabel}: `));
      process.stdout.write("\x1b[1A");
      process.stdout.write("\x1b[2K\r");
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
    const update = await rl.question(
      chalk.dim(`  Key already set (ends in ${existing.slice(-4)}). Update? (y/N): `)
    );
    if (update.trim().toLowerCase() === "y") {
      while (true) {
        const key = await rl.question(chalk.hex("#7c3aed")(`  New ${info.keyLabel}: `));
        process.stdout.write("\x1b[1A");
        process.stdout.write("\x1b[2K\r");
        process.stdout.write("\x1b[1A");
        process.stdout.write("\x1b[2K\r");
        if (key.trim().length > 10) { 
          config.apiKeys[provider] = key.trim();
          saveConfig(config);
          console.log(chalk.green("  ✓ API key saved.")); 
          break; }
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

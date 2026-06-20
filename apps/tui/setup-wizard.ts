// apps/tui/setup-wizard.ts
// Interactive first-run setup wizard.
// Shows supported providers with arrow-key selection, collects API key,
// then lets user pick a model. Saves config to ~/.config/resolv/config.json.
// Ollama path includes install instructions.

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import chalk from "chalk";
import {
  type ProviderName,
  type ResolvConfig,
  PROVIDER_INFO,
  isFirstRun,
  loadConfig,
  saveConfig,
} from "../../config/config.js";

const PROVIDERS: ProviderName[] = ["anthropic", "google", "nim", "ollama"];

// ── ANSI helpers ──────────────────────────────────────────────
const clearLine = () => process.stdout.write("\r\x1b[K");
const moveCursor = (n: number) => process.stdout.write(`\x1b[${Math.abs(n)}${n < 0 ? "A" : "B"}`);
const hideCursor = () => process.stdout.write("\x1b[?25l");
const showCursor = () => process.stdout.write("\x1b[?25h");

function drawProviderMenu(providers: ProviderName[], selected: number) {
  for (let i = 0; i < providers.length; i++) {
    const info = PROVIDER_INFO[providers[i]!]!;
    clearLine();
    if (i === selected) {
      process.stdout.write(
        `  ${chalk.bgHex("#7c3aed").white.bold(` ❯ ${info.label} `)}  ${chalk.dim(info.description)}\n`
      );
    } else {
      process.stdout.write(
        `    ${chalk.white(info.label)}  ${chalk.dim(info.description)}\n`
      );
    }
  }
}

async function selectFromList<T extends string>(
  options: T[],
  renderFn: (options: T[], selected: number) => void
): Promise<T> {
  if (!process.stdin.isTTY) {
    throw new Error("Interactive setup requires a TTY.");
  }

  hideCursor();

  let selected = 0;

  // Initial render
  renderFn(options, selected);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      showCursor();
      process.stdin.setRawMode(false);
      process.stdin.removeListener("data", onKey);
      process.stdin.pause();
    };

    const onKey = (key: Buffer) => {
      const str = key.toString();

      if (str.includes("\u0003")) {
        cleanup();
        reject(new Error("Setup cancelled."));
        return;
      }

      const upCount = str.match(/\x1b\[A/g)?.length ?? 0;
      const downCount = str.match(/\x1b\[B/g)?.length ?? 0;
      const nextSelected = Math.max(0, Math.min(options.length - 1, selected - upCount + downCount));

      if (nextSelected !== selected) {
        moveCursor(-options.length);
        selected = nextSelected;
        renderFn(options, selected);
      }

      if (str.includes("\r") || str.includes("\n")) {
        cleanup();
        resolve(options[selected]!);
      }
    };

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onKey);
  });
}

function drawModelMenu(models: string[], selected: number) {
  for (let i = 0; i < models.length; i++) {
    clearLine();
    if (i === selected) {
      process.stdout.write(
        `  ${chalk.bgHex("#7c3aed").white.bold(` ❯ ${models[i]} `)}\n`
      );
    } else {
      process.stdout.write(`    ${chalk.white(models[i])}\n`);
    }
  }
}                                            

function printBanner() {
  
  console.log("");
  console.log(chalk.hex("#7c3aed").bold(" ██████╗ ███████╗███████╗ ██████╗ ██╗    ██╗   ██╗    ██╗ "));
  console.log(chalk.hex("#7c3aed").bold(" ██╔══██╗██╔════╝██╔════╝██╔═══██╗██║    ██║   ██║    ██║ "));
  console.log(chalk.hex("#a78bfa").bold(" ██████╔╝█████╗  ███████╗██║   ██║██║    ██║   ██║    ██║ "));
  console.log(chalk.hex("#a78bfa").bold(" ██╔══██╗██╔══╝  ╚════██║██║   ██║██║    ╚██╗ ██╔╝    ╚═╝ "));
  console.log(chalk.hex("#c4b5fd").bold(" ██║  ██║███████╗███████║╚██████╔╝███████╗╚████╔╝     ██╗ "));
  console.log(chalk.hex("#c4b5fd").bold(" ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚══════╝ ╚═══╝      ╚═╝ "));
  console.log("");
  console.log(chalk.dim("  Style-matching GitHub issue resolver"));
  console.log("");
}

function printOllamaInstructions() {
  console.log("");
  console.log(chalk.hex("#7c3aed").bold("  Setting up Ollama (local LLM)"));
  console.log(chalk.dim("  ─────────────────────────────────────────────"));
  console.log("");
  console.log("  Ollama lets you run AI models on your own machine — no API key needed.");
  console.log("");
  console.log(`  ${chalk.bold("Step 1:")} Install Ollama`);
  console.log(`    ${chalk.cyan("curl -fsSL https://ollama.com/install.sh | sh")}`);
  console.log(`    Or download from ${chalk.underline("https://ollama.com/download")}`);
  console.log("");
  console.log(`  ${chalk.bold("Step 2:")} Pull a model (pick one)`);
  console.log(`    ${chalk.cyan("ollama pull deepseek-r1:8b")}   ${chalk.dim("# ~5GB, best for code")}`);
  console.log(`    ${chalk.cyan("ollama pull llama3.2:3b")}       ${chalk.dim("# ~2GB, fast")}`);
  console.log(`    ${chalk.cyan("ollama pull codellama:13b")}     ${chalk.dim("# ~8GB, code-specialized")}`);
  console.log("");
  console.log(`  ${chalk.bold("Step 3:")} Make sure Ollama is running`);
  console.log(`    ${chalk.cyan("ollama serve")}`);
  console.log("");
  console.log(`  resolv connects to Ollama at ${chalk.cyan("http://localhost:11434")} by default.`);
  console.log(`  Override with ${chalk.dim("OLLAMA_BASE_URL=http://yourhost:11434")}`);
  console.log("");
}

async function getApiKey(rl: readline.Interface, providerName: ProviderName): Promise<string> {
  const info = PROVIDER_INFO[providerName]!;
  console.log("");
  console.log(chalk.dim(`  Get your key at: ${info.description.split("Get key at")[1]?.trim() ?? info.description}`));
  console.log("");

  while (true) {
    const key = await rl.question(chalk.hex("#7c3aed")(`  Enter ${info.keyLabel}: `));
    const trimmed = key.trim();
    if (trimmed.length > 10) return trimmed;
    console.log(chalk.red("  Key looks too short — try again."));
  }
}

// async function getGithubToken(rl: readline.Interface, providerName: ProviderName): Promise<string> {
//   const
// }

export async function runSetupWizard(): Promise<void> {
  printBanner();

  const firstRun = isFirstRun();
  const config = loadConfig();
  let selectedProvider = config.provider;

  console.log(chalk.bold(firstRun ? "  Welcome! Let's set up resolv.\n" : "  Resuming setup.\n"));

  if (firstRun) {
    console.log("  Choose your AI provider:\n");
    selectedProvider = await selectFromList(PROVIDERS, drawProviderMenu);
    config.provider = selectedProvider;
    saveConfig(config);
  } else {
    console.log(`  ${chalk.green("✓")} Provider: ${chalk.bold(PROVIDER_INFO[selectedProvider]!.label)}`);
  }

  const providerInfo = PROVIDER_INFO[selectedProvider]!;

  if (firstRun) {
    console.log("");
    console.log(`  ${chalk.green("✓")} Selected: ${chalk.bold(providerInfo.label)}`);
  }

  // Ollama — no API key, just instructions
  if (selectedProvider === "ollama") {
    printOllamaInstructions();

    if (!config.model || !providerInfo.models.includes(config.model)) {
      console.log("\n  Which model do you want to use?\n");
      config.model = await selectFromList(providerInfo.models, drawModelMenu);
      saveConfig(config);
    }
    console.log(`\n  ${chalk.green("✓")} Model: ${chalk.bold(config.model)}`);
  } else {
    // API key collection
    if (!config.apiKeys[selectedProvider]) {
      const rl = readline.createInterface({ input, output });
      config.apiKeys[selectedProvider] = await getApiKey(rl, selectedProvider);
      rl.close();
      saveConfig(config);
    } else {
      console.log(`  ${chalk.green("✓")} ${providerInfo.keyLabel} already saved`);
    }

    // Model selection
    if (!config.model || !providerInfo.models.includes(config.model)) {
      console.log("\n  Which model do you want to use?\n");
      config.model = await selectFromList(providerInfo.models, drawModelMenu);
      saveConfig(config);
    }
    console.log(`\n  ${chalk.green("✓")} Model: ${chalk.bold(config.model)}`);
  }

  // Optional GitHub token
  if (config.githubToken) {
    console.log(`  ${chalk.green("✓")} GitHub token already saved`);
  } else {
    const rl = readline.createInterface({ input, output });
    console.log("");
    const addGithub = await rl.question(chalk.dim("  Add GitHub token for PR creation? (y/N): "));

    if (addGithub.trim().toLowerCase() === "y") {
      console.log(chalk.dim("  Generate at: https://github.com/settings/tokens (needs repo write access)"));
      const token = await rl.question(chalk.hex("#7c3aed")("  GitHub Token: "));
      if (token.trim()) config.githubToken = token.trim();
    }
    rl.close();
  }

  saveConfig(config as ResolvConfig);

  console.log("");
  console.log(chalk.green.bold("  ✓ Setup complete! Config saved to ~/.config/resolv/config.json"));
  console.log(chalk.dim("  Run `resolv` to start the interactive shell."));
  console.log("");
}

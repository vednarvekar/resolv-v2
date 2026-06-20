// apps/tui/setup-wizard.ts
// Interactive first-run setup wizard with all providers.

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

const PROVIDERS: ProviderName[] = ["anthropic", "openai", "google", "grok", "openrouter", "nim", "ollama"];

const clearLine = () => process.stdout.write("\r\x1b[K");
const moveCursor = (n: number) => process.stdout.write(`\x1b[${Math.abs(n)}${n < 0 ? "A" : "B"}`);
const hideCursor = () => process.stdout.write("\x1b[?25l");
const showCursor = () => process.stdout.write("\x1b[?25h");

function drawMenu<T extends string>(
  items: T[],
  selected: number,
  labelFn: (item: T) => string,
  dimFn?: (item: T) => string
) {
  for (let i = 0; i < items.length; i++) {
    clearLine();
    const label = labelFn(items[i]!);
    const dim = dimFn?.(items[i]!) ?? "";
    if (i === selected) {
      process.stdout.write(`  ${chalk.bgHex("#7c3aed").white.bold(` ❯ ${label} `)}  ${chalk.dim(dim)}\n`);
    } else {
      process.stdout.write(`    ${chalk.white(label)}  ${chalk.dim(dim)}\n`);
    }
  }
}

async function selectFromList<T extends string>(
  items: T[],
  labelFn: (item: T) => string,
  dimFn?: (item: T) => string
): Promise<T> {
  if (!process.stdin.isTTY) throw new Error("Interactive setup requires a TTY.");

  hideCursor();
  let selected = 0;
  drawMenu(items, selected, labelFn, dimFn);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      showCursor();
      process.stdin.setRawMode(false);
      process.stdin.removeListener("data", onKey);
      process.stdin.pause();
    };

    const onKey = (key: Buffer) => {
      const str = key.toString();
      if (str.includes("\u0003")) { cleanup(); reject(new Error("Setup cancelled.")); return; }

      const up = (str.match(/\x1b\[A/g) ?? []).length;
      const down = (str.match(/\x1b\[B/g) ?? []).length;
      const next = Math.max(0, Math.min(items.length - 1, selected - up + down));

      if (next !== selected) {
        moveCursor(-items.length);
        selected = next;
        drawMenu(items, selected, labelFn, dimFn);
      }

      if (str.includes("\r") || str.includes("\n")) {
        cleanup();
        resolve(items[selected]!);
      }
    };

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onKey);
  });
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
  console.log(chalk.hex("#7c3aed").bold("  Ollama — local LLM setup"));
  console.log(chalk.dim("  " + "─".repeat(48)));
  console.log(`\n  ${chalk.bold("1.")} Install: ${chalk.cyan("curl -fsSL https://ollama.com/install.sh | sh")}`);
  console.log(`     Or download from ${chalk.underline("https://ollama.com/download")}`);
  console.log(`\n  ${chalk.bold("2.")} Pull a model:`);
  console.log(`     ${chalk.cyan("ollama pull qwen3.5:4b")}      ${chalk.dim("# 2.5GB, fast, good for code")}`);
  console.log(`     ${chalk.cyan("ollama pull deepseek-r1:8b")} ${chalk.dim("# 5GB, best reasoning")}`);
  console.log(`     ${chalk.cyan("ollama pull codellama:13b")}   ${chalk.dim("# 8GB, code-specialized")}`);
  console.log(`\n  ${chalk.bold("3.")} Start Ollama: ${chalk.cyan("ollama serve")}`);
  console.log(`\n  ${chalk.bold("WSL users:")} see README for mirrored networking setup.`);
  console.log(`\n  resolv connects to ${chalk.cyan("http://127.0.0.1:11434")} by default.`);
  console.log(`  Override: ${chalk.dim("OLLAMA_BASE_URL=http://yourhost:11434")}\n`);
}

export async function runSetupWizard(): Promise<void> {
  printBanner();

  const firstRun = isFirstRun();
  const config = loadConfig();

  console.log(chalk.bold(firstRun ? "  Welcome! Let's set up resolv.\n" : "  Re-running setup.\n"));
  console.log("  Choose your AI provider:\n");

  const selected = await selectFromList(
    PROVIDERS,
    (p) => PROVIDER_INFO[p]!.label,
    (p) => PROVIDER_INFO[p]!.description
  );

  config.provider = selected;
  saveConfig(config as ResolvConfig);

  const info = PROVIDER_INFO[selected]!;
  console.log(`\n  ${chalk.green("✓")} ${chalk.bold(info.label)}\n`);

  if (selected === "ollama") {
    printOllamaInstructions();
  } else {
    // API key
    const existingKey = config.apiKeys[selected];
    if (existingKey) {
      console.log(`  ${chalk.green("✓")} API key already saved (ends in ${existingKey.slice(-4)})`);
    } else {
      const rl = readline.createInterface({ input, output });
      console.log(chalk.dim(`  ${info.description}`));
      while (true) {
        const key = await rl.question(chalk.hex("#7c3aed")(`  Enter ${info.keyLabel}: `));
        if (key.trim().length > 10) { config.apiKeys[selected] = key.trim(); break; }
        console.log(chalk.red("  Key too short — try again."));
      }
      rl.close();
      saveConfig(config as ResolvConfig);
    }
  }

  // Model selection
  if (!config.model || !info.models.includes(config.model)) {
    console.log("\n  Choose a model:\n");
    config.model = await selectFromList(info.models, (m) => m);
    saveConfig(config as ResolvConfig);
  }
  console.log(`  ${chalk.green("✓")} Model: ${chalk.bold(config.model ?? info.defaultModel)}\n`);

  // GitHub token (optional)
  if (!config.githubToken) {
    const rl = readline.createInterface({ input, output });
    const addGh = await rl.question(chalk.dim("  Add GitHub token for PR creation? (y/N): "));
    if (addGh.trim().toLowerCase() === "y") {
      console.log(chalk.dim("  github.com/settings/tokens → New token → repo scope"));
      const token = await rl.question(chalk.hex("#7c3aed")("  GitHub Token: "));
      if (token.trim()) { config.githubToken = token.trim(); saveConfig(config as ResolvConfig); }
    }
    rl.close();
  } else {
    console.log(`  ${chalk.green("✓")} GitHub token already saved`);
  }

  // Brave Search (optional)
  if (!process.env.BRAVE_SEARCH_API_KEY) {
    console.log(chalk.dim("\n  Optional: BRAVE_SEARCH_API_KEY in .env enables faster web search."));
    console.log(chalk.dim("  Free tier at search.brave.com/rewards · Falls back to DuckDuckGo if unset."));
  }

  console.log("");
  console.log(chalk.green.bold("  ✓ Setup complete! Config saved to ~/.config/resolv/config.json"));
  console.log(chalk.dim("  Run `resolv` to start the interactive shell.\n"));
}
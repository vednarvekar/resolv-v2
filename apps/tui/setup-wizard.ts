// apps/tui/setup-wizard.ts
// Interactive first-run setup wizard with all providers.
// Uses inquirer for ALL interactive input (consistent with the rest of the
// app) — never mix inquirer with a raw readline.Interface or hand-rolled
// stdin listeners in the same process; that's what was causing the broken
// styling and hangs.

import inquirer from "inquirer";
import chalk from "chalk";
import {
  type ProviderName,
  type ResolvConfig,
  PROVIDER_INFO,
  isFirstRun,
  loadConfig,
  saveConfig,
} from "../../config/config.js";
import { createProviderFromConfig } from "../../packages/providers/register.js";

const PROVIDERS: ProviderName[] = ["anthropic", "openai", "google", "grok", "openrouter", "nim", "ollama"];

async function selectFromList<T extends string>(
  items: T[],
  labelFn: (item: T) => string,
  dimFn?: (item: T) => string,
  message = "Select:"
): Promise<T> {
  const { choice } = await inquirer.prompt([
    {
      type: "select",
      name: "choice",
      message,
      choices: items.map((item) => ({
        name: dimFn ? `${labelFn(item)}  ${chalk.dim(dimFn(item))}` : labelFn(item),
        value: item,
      })),
    },
  ]);
  return choice;
}

async function selectModelName(info: {
  label: string;
  keyEnv: string | null;
  keyLabel: string | null;
  defaultModel: string;
  description: string;
}, config: ResolvConfig): Promise<string> {
  const provider = createProviderFromConfig(config);
  const models = await provider.listModels?.().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.log(chalk.yellow(`  Could not fetch provider model list: ${message}`));
    return undefined;
  });

  if (models?.length) {
    console.log(chalk.dim("  Fetched available models from provider. Use the arrow keys to select one."));
    return await selectFromList(models, (m) => m, undefined, "Choose model:");
  }

  const { custom } = await inquirer.prompt([{
    type: "input",
    name: "custom",
    message: `  Enter model name [${info.defaultModel}]:`,
  }]);
  return custom.trim() || info.defaultModel;
}

export function printBanner() {
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
    (p) => PROVIDER_INFO[p]!.description,
    "Choose provider:"
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
      console.log(chalk.dim(`  ${info.description}`));
      while (true) {
        const { key } = await inquirer.prompt([{
          type: "password",
          name: "key",
          message: `  Enter ${info.keyLabel}:`,
          mask: "*",
        }]);
        if (key.trim().length > 10) { config.apiKeys[selected] = key.trim(); break; }
        console.log(chalk.red("  Key too short — try again."));
      }
      saveConfig(config as ResolvConfig);
    }
  }

  // Model selection
  if (!config.model) {
    console.log("\n  Choose a model:\n");
    config.model = await selectModelName(info, config as ResolvConfig);
    saveConfig(config as ResolvConfig);
  }
  console.log(`  ${chalk.green("✓")} Model: ${chalk.bold(config.model ?? info.defaultModel)}\n`);

  // GitHub token (optional)
  if (!config.githubToken) {
    const { addGh } = await inquirer.prompt([{
      type: "confirm",
      name: "addGh",
      message: "  Add GitHub token for PR creation?",
      default: false,
    }]);
    if (addGh) {
      console.log(chalk.dim("  github.com/settings/tokens → New token → repo scope"));
      const { token } = await inquirer.prompt([{
        type: "password",
        name: "token",
        message: "  GitHub Token:",
        mask: "*",
      }]);
      if (token.trim()) { config.githubToken = token.trim(); saveConfig(config as ResolvConfig); }
    }
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

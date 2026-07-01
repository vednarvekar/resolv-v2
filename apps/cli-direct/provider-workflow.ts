import chalk from "chalk";
import inquirer from "inquirer";

import { PROVIDER_INFO, type ProviderName, type ResolvConfig } from "../../config/config.js";
import { createProviderFromEnv } from "../../packages/providers/register.js";
import { selectFromList, dimDescription } from "./provider-ui.js";

export const PROVIDERS: ProviderName[] = ["anthropic", "google", "nim", "ollama", "grok", "openai", "openrouter"];

const modelCache = new Map<string, string[]>();

export async function fetchProviderModels(config: ResolvConfig): Promise<string[] | undefined> {
  const cacheKey = `${config.provider}:${JSON.stringify(config.apiKeys[config.provider] ?? "")}`;
  if (modelCache.has(cacheKey)) return modelCache.get(cacheKey);

  const provider = createProviderFromEnv(config);
  if (typeof provider.listModels !== "function") return undefined;

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

export async function chooseProvider(args: string): Promise<ProviderName> {
  const targetProvider = args.trim() as ProviderName | "";
  if (targetProvider && PROVIDERS.includes(targetProvider)) return targetProvider;

  console.log("\n  Select provider:\n");
  return await selectFromList(PROVIDERS, (name) => {
    const info = PROVIDER_INFO[name]!;
    return dimDescription(info.label, info.description);
  }, "Choose provider:");
}

export async function chooseModelName(
  info: typeof PROVIDER_INFO[keyof typeof PROVIDER_INFO],
  config: ResolvConfig,
): Promise<string> {
  const remoteModels = await fetchProviderModels(config);
  if (remoteModels?.length) {
    console.log(chalk.dim("\n  Fetched available models from provider. Use the arrow keys to select one."));
    return await selectFromList(remoteModels, (m) => m, "Choose model:");
  }

  console.log(chalk.yellow("  Could not fetch models interactively. Please enter model name manually."));
  const { custom } = await inquirer.prompt([{
    type: "input",
    name: "custom",
    message: `  Enter model name [${info.defaultModel}]:`,
  }]);
  return custom.trim() || info.defaultModel;
}

// packages/providers/register.ts
// Single place that constructs Provider instances from config.
// Never imports provider SDKs directly in the rest of the codebase.

import { UnknownProviderError } from "../core/errors.js";
import { AnthropicProvider } from "./anthropic/anthropic-provider.js";
import { GeminiProvider } from "./google/gemini-provider.js";
import { NimProvider } from "./nim/nim-provider.js";
import { OllamaProvider } from "./ollama/ollama_provider.js";
import type { Provider } from "./provider.js";
import { loadConfig, type ResolvConfig } from "../../config/config.js";

export type ProviderName = "nim" | "anthropic" | "google" | "ollama";

export const SUPPORTED_PROVIDERS: ProviderName[] = ["anthropic", "google", "nim", "ollama"];

export function isSupportedProvider(name: string): name is ProviderName {
  return (SUPPORTED_PROVIDERS as string[]).includes(name);
}

/**
 * Build a Provider from an explicit config object.
 * Preferred over createProviderFromEnv when config is already loaded.
 */
export function createProviderFromConfig(config: ResolvConfig): Provider {
  const { provider, apiKeys } = config;

  switch (provider) {
    case "anthropic": {
      const key = apiKeys.anthropic;
      if (!key) throw new Error("ANTHROPIC_API_KEY is required. Run /provider to configure.");
      return new AnthropicProvider(key);
    }
    case "google": {
      const key = apiKeys.google;
      if (!key) throw new Error("GOOGLE_API_KEY is required. Run /provider to configure.");
      return new GeminiProvider(key);
    }
    case "nim": {
      const key = apiKeys.nim;
      if (!key) throw new Error("NVIDIA_API_KEY is required. Run /provider to configure.");
      return new NimProvider(key);
    }
    case "ollama":
      return new OllamaProvider();
    default:
      throw new UnknownProviderError(provider);
  }
}

/**
 * Build a Provider from environment variables or config file.
 * Accepts an optional pre-loaded config to avoid re-reading disk.
 */
export function createProviderFromEnv(config?: ResolvConfig): Provider {
  const c = config ?? loadConfig();
  return createProviderFromConfig(c);
}

export function listAvailableProviders(): ProviderName[] {
  return [...SUPPORTED_PROVIDERS];
}
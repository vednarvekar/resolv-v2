// packages/providers/register.ts
// Factory: builds a Provider from a loaded ResolvConfig.
// Only place in the codebase that knows about concrete provider classes.

import { UnknownProviderError } from "../core/errors.js";
import { AnthropicProvider } from "./anthropic/anthropic-provider.js";
import { GeminiProvider } from "./google/gemini-provider.js";
import { NimProvider } from "./nim/nim-provider.js";
import { OllamaProvider } from "./ollama/ollama_provider.js";
import { OpenAIProvider } from "./openai/openai-provider.js";
import { GrokProvider } from "./grok/grok-provider.js";
import { OpenRouterProvider } from "./openrouter/openrouter-provider.js";
import type { Provider } from "./provider.js";
import { loadConfig, type ResolvConfig } from "../../config/config.js";

export type { ResolvConfig };
export type ProviderName = "nim" | "anthropic" | "google" | "ollama" | "openai" | "grok" | "openrouter";

export const SUPPORTED_PROVIDERS: ProviderName[] = [
  "anthropic", "google", "openai", "grok", "openrouter", "nim", "ollama",
];

export function isSupportedProvider(name: string): name is ProviderName {
  return (SUPPORTED_PROVIDERS as string[]).includes(name);
}

export function createProviderFromConfig(config: ResolvConfig): Provider {
  const { provider, apiKeys, model } = config;

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
    case "openai": {
      const key = apiKeys.openai;
      if (!key) throw new Error("OPENAI_API_KEY is required. Run /provider to configure.");
      return new OpenAIProvider(key, model);
    }
    case "grok": {
      const key = apiKeys.grok;
      if (!key) throw new Error("XAI_API_KEY is required. Run /provider to configure.");
      return new GrokProvider(key, model);
    }
    case "openrouter": {
      const key = apiKeys.openrouter;
      if (!key) throw new Error("OPENROUTER_API_KEY is required. Run /provider to configure.");
      return new OpenRouterProvider(key, model);
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

export function createProviderFromEnv(config?: ResolvConfig): Provider {
  return createProviderFromConfig(config ?? loadConfig());
}

export function listAvailableProviders(): ProviderName[] {
  return [...SUPPORTED_PROVIDERS];
}
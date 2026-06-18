// ============================================================
// resolv — providers/registry.ts
// The one place that knows which Provider implementations exist and how
// to construct them. Everything else asks this registry for "the current
// provider" and never imports a concrete provider class directly — that's
// what makes `/model` switching and RESOLV_PROVIDER env-based selection work
// without touching agent-loop.ts or any tool.
// ============================================================

import { UnknownProviderError } from "../core/errors.js";
import { AnthropicProvider } from "./anthropic/anthropic-provider.js";
import { GeminiProvider } from "./google/gemini-provider.js";
import { NimProvider } from "./nim/nim-provider.js";
import type { Provider } from "./provider.js";

export type ProviderName = "nim" | "anthropic" | "google";

export interface ProviderCredentials {
  nimApiKey?: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
}

const SUPPORTED_PROVIDERS: ProviderName[] = ["nim", "anthropic", "google"];

export function isSupportedProvider(name: string): name is ProviderName {
  return (SUPPORTED_PROVIDERS as string[]).includes(name);
}

/**
 * Builds a Provider instance by name. Throws UnknownProviderError for
 * anything not in SUPPORTED_PROVIDERS, and a clear credential error if the
 * matching API key wasn't supplied.
 */
export function createProvider(name: ProviderName, credentials: ProviderCredentials): Provider {
  switch (name) {
    case "nim":
      if (!credentials.nimApiKey) throw new Error("NVIDIA_API_KEY is required to use the nim provider.");
      return new NimProvider(credentials.nimApiKey);

    case "anthropic":
      if (!credentials.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is required to use the anthropic provider.");
      return new AnthropicProvider(credentials.anthropicApiKey);

    case "google":
      if (!credentials.googleApiKey) throw new Error("GOOGLE_API_KEY is required to use the google provider.");
      return new GeminiProvider(credentials.googleApiKey);

    default:
      throw new UnknownProviderError(name);
  }
}

/**
 * Reads RESOLV_PROVIDER from the environment (defaulting to "nim", since
 * that's resolv's free-tier default) and constructs the matching Provider
 * using whichever credentials are present in process.env.
 */
export function createProviderFromEnv(): Provider {
  const requested = process.env.RESOLV_PROVIDER ?? "nim";

  if (!isSupportedProvider(requested)) {
    throw new UnknownProviderError(requested);
  }

  return createProvider(requested, {
    nimApiKey: process.env.NVIDIA_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    googleApiKey: process.env.GOOGLE_API_KEY,
  });
}

export function listAvailableProviders(): ProviderName[] {
  return [...SUPPORTED_PROVIDERS];
}
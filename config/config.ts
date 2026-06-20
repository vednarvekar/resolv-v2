// config/config.ts
// Central config manager. Handles:
// - Reading/writing ~/.config/resolv/config.json
// - API key storage (never in source tree)
// - Provider + model selection
// - First-run detection

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export type ProviderName = "anthropic" | "google" | "nim" | "ollama";

export interface ResolvConfig {
  provider: ProviderName;
  model?: string;
  apiKeys: Partial<Record<ProviderName, string>>;
  githubToken?: string;
  testCommand: string;
  maxHealAttempts: number;
}

export interface AppConfig {
  githubToken?: string;
  model?: string;
  testCommand: string;
  maxHealAttempts: number;
}

const CONFIG_DIR = path.join(os.homedir(), ".config", "resolv");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

const DEFAULTS: ResolvConfig = {
  provider: "anthropic",
  apiKeys: {},
  testCommand: "npm test",
  maxHealAttempts: 4,
};

export const PROVIDER_INFO: Record<ProviderName, {
  label: string;
  keyEnv: string | null;
  keyLabel: string | null;
  defaultModel: string;
  models: string[];
  description: string;
}> = {
  anthropic: {
    label: "Anthropic (Claude)",
    keyEnv: "ANTHROPIC_API_KEY",
    keyLabel: "Anthropic API Key",
    defaultModel: "claude-sonnet-4-6",
    models: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
    description: "Best quality. Get key at console.anthropic.com",
  },
  google: {
    label: "Google (Gemini)",
    keyEnv: "GOOGLE_API_KEY",
    keyLabel: "Google AI API Key",
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
    description: "Fast and capable. Get key at aistudio.google.com",
  },
  nim: {
    label: "NVIDIA NIM",
    keyEnv: "NVIDIA_API_KEY",
    keyLabel: "NVIDIA API Key",
    defaultModel: "google/gemma-4-31b-it",
    models: [
      "google/gemma-4-31b-it",
      "deepseek-ai/deepseek-r1",
      "meta/llama-3.3-70b-instruct",
      "mistralai/mistral-large-2-instruct",
    ],
    description: "NVIDIA hosted models. Get key at build.nvidia.com",
  },
  ollama: {
    label: "Ollama (Local LLM)",
    keyEnv: null,
    keyLabel: null,
    defaultModel: "qwen3.5:4b",
    models: ["deepseek-r1:8b", "llama3.2:3b", "mistral:7b", "codellama:13b", "qwen3.5:4b"],
    description: "Run models locally. No API key needed.",
  },
};

export function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): ResolvConfig {
  ensureConfigDir();

  // Layer: file config -> env vars
  let fileConfig: Partial<ResolvConfig> = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    } catch {
      fileConfig = {};
    }
  }

  const merged: ResolvConfig = { ...DEFAULTS, ...fileConfig };
  merged.apiKeys = fileConfig.apiKeys ?? {};

  // Env var overrides (for CI/power users)
  if (process.env.ANTHROPIC_API_KEY) merged.apiKeys.anthropic = process.env.ANTHROPIC_API_KEY;
  if (process.env.GOOGLE_API_KEY) merged.apiKeys.google = process.env.GOOGLE_API_KEY;
  if (process.env.NVIDIA_API_KEY) merged.apiKeys.nim = process.env.NVIDIA_API_KEY;
  if (process.env.RESOLV_PROVIDER) merged.provider = process.env.RESOLV_PROVIDER as ProviderName;
  if (process.env.RESOLV_MODEL) merged.model = process.env.RESOLV_MODEL;
  if (process.env.GITHUB_TOKEN) merged.githubToken = process.env.GITHUB_TOKEN;

  return merged;
}

export function saveConfig(config: ResolvConfig): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 }); // owner read/write only
}

export function isFirstRun(): boolean {
  return !fs.existsSync(CONFIG_FILE);
}

export function getActiveApiKey(config: ResolvConfig): string | undefined {
  if (config.provider === "ollama") return undefined;
  return config.apiKeys[config.provider];
}

export function isConfigured(config: ResolvConfig): boolean {
  if (config.provider === "ollama") return true;
  return !!getActiveApiKey(config);
}

export function loadAppConfig(): AppConfig {
  const c = loadConfig();
  return {
    githubToken: c.githubToken,
    model: c.model,
    testCommand: c.testCommand,
    maxHealAttempts: c.maxHealAttempts,
  };
}
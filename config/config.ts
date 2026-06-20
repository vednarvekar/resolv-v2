// config/config.ts
// Central config manager. Reads/writes ~/.config/resolv/config.json
// API keys never stored in the source tree.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export type ProviderName = "anthropic" | "google" | "nim" | "ollama" | "openai" | "grok" | "openrouter";

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
    description: "Best quality. console.anthropic.com",
  },
  google: {
    label: "Google (Gemini)",
    keyEnv: "GOOGLE_API_KEY",
    keyLabel: "Google AI API Key",
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
    description: "Fast and capable. aistudio.google.com",
  },
  openai: {
    label: "OpenAI (GPT)",
    keyEnv: "OPENAI_API_KEY",
    keyLabel: "OpenAI API Key",
    defaultModel: "gpt-4o",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1-mini"],
    description: "GPT-4o and more. platform.openai.com",
  },
  grok: {
    label: "xAI Grok",
    keyEnv: "XAI_API_KEY",
    keyLabel: "xAI API Key",
    defaultModel: "grok-3-mini",
    models: ["grok-3", "grok-3-mini", "grok-3-fast"],
    description: "Grok models by xAI. console.x.ai",
  },
  openrouter: {
    label: "OpenRouter (Multi-model)",
    keyEnv: "OPENROUTER_API_KEY",
    keyLabel: "OpenRouter API Key",
    defaultModel: "anthropic/claude-sonnet-4-6",
    models: [
      "anthropic/claude-sonnet-4-6",
      "openai/gpt-4o",
      "google/gemini-2.5-flash",
      "meta-llama/llama-3.3-70b-instruct",
      "deepseek/deepseek-r1",
      "mistralai/mistral-large",
      "qwen/qwen-2.5-72b-instruct",
    ],
    description: "200+ models, one key. openrouter.ai",
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
      "nvidia/llama-3.1-nemotron-ultra-253b-v1",
    ],
    description: "NVIDIA hosted models. build.nvidia.com",
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
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

export function loadConfig(): ResolvConfig {
  ensureConfigDir();

  let fileConfig: Partial<ResolvConfig> = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try { fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")); }
    catch { fileConfig = {}; }
  }

  const merged: ResolvConfig = { ...DEFAULTS, ...fileConfig };
  merged.apiKeys = { ...(fileConfig.apiKeys ?? {}) };

  // Env var overrides
  if (process.env.ANTHROPIC_API_KEY) merged.apiKeys.anthropic = process.env.ANTHROPIC_API_KEY;
  if (process.env.GOOGLE_API_KEY) merged.apiKeys.google = process.env.GOOGLE_API_KEY;
  if (process.env.NVIDIA_API_KEY) merged.apiKeys.nim = process.env.NVIDIA_API_KEY;
  if (process.env.OPENAI_API_KEY) merged.apiKeys.openai = process.env.OPENAI_API_KEY;
  if (process.env.XAI_API_KEY) merged.apiKeys.grok = process.env.XAI_API_KEY;
  if (process.env.OPENROUTER_API_KEY) merged.apiKeys.openrouter = process.env.OPENROUTER_API_KEY;
  if (process.env.RESOLV_PROVIDER) merged.provider = process.env.RESOLV_PROVIDER as ProviderName;
  if (process.env.RESOLV_MODEL) merged.model = process.env.RESOLV_MODEL;
  if (process.env.GITHUB_TOKEN) merged.githubToken = process.env.GITHUB_TOKEN;

  return merged;
}

export function saveConfig(config: ResolvConfig): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
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
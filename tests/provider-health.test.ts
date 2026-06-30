import { afterEach, describe, expect, it, vi } from "vitest";
import { createProviderFromConfig, listAvailableProviders } from "../packages/providers/register.js";
import type { ResolvConfig } from "../config/config.js";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const mockFetchOk = (body: unknown) => vi.fn().mockResolvedValue(jsonResponse(body));

describe("provider registration and health checks", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists all supported providers", () => {
    expect(listAvailableProviders()).toEqual(
      expect.arrayContaining(["anthropic", "google", "openai", "grok", "openrouter", "nim", "ollama"])
    );
  });

  it("creates OpenAI provider and checks model availability via /models", async () => {
    vi.stubGlobal("fetch", mockFetchOk({ data: [{ id: "gpt-4o" }] }));
    const config: ResolvConfig = {
      provider: "openai",
      model: "gpt-4o",
      apiKeys: { openai: "test-key" },
      testCommand: "npm test",
      maxHealAttempts: 4,
    };
    const provider = createProviderFromConfig(config);
    expect(provider.name).toBe("openai");
    await expect(provider.healthCheck?.(config.model)).resolves.toBeUndefined();
  });

  it("creates Grok provider and checks model availability via /models", async () => {
    vi.stubGlobal("fetch", mockFetchOk({ data: [{ id: "grok-3" }] }));
    const config: ResolvConfig = {
      provider: "grok",
      model: "grok-3",
      apiKeys: { grok: "test-key" },
      testCommand: "npm test",
      maxHealAttempts: 4,
    };
    const provider = createProviderFromConfig(config);
    expect(provider.name).toBe("grok");
    await expect(provider.healthCheck?.(config.model)).resolves.toBeUndefined();
  });

  it("creates NVIDIA NIM provider and checks model availability via /models", async () => {
    vi.stubGlobal("fetch", mockFetchOk({ data: [{ id: "google/gemma-4-31b-it" }] }));
    const config: ResolvConfig = {
      provider: "nim",
      model: "google/gemma-4-31b-it",
      apiKeys: { nim: "test-key" },
      testCommand: "npm test",
      maxHealAttempts: 4,
    };
    const provider = createProviderFromConfig(config);
    expect(provider.name).toBe("nim");
    await expect(provider.healthCheck?.(config.model)).resolves.toBeUndefined();
  });

  it("creates OpenRouter provider and performs a minimal chat health check", async () => {
    vi.stubGlobal("fetch", mockFetchOk({
      choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    const config: ResolvConfig = {
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4-6",
      apiKeys: { openrouter: "test-key" },
      testCommand: "npm test",
      maxHealAttempts: 4,
    };
    const provider = createProviderFromConfig(config);
    expect(provider.name).toBe("openrouter");
    await expect(provider.healthCheck?.(config.model)).resolves.toBeUndefined();
  });

  it("creates Anthropic provider without requiring health check", () => {
    const config: ResolvConfig = {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      apiKeys: { anthropic: "test-key" },
      testCommand: "npm test",
      maxHealAttempts: 4,
    };
    const provider = createProviderFromConfig(config);
    expect(provider.name).toBe("anthropic");
    expect(provider.defaultModel).toBe("claude-sonnet-4-6");
  });

  it("creates Google Gemini provider without requiring health check", () => {
    const config: ResolvConfig = {
      provider: "google",
      model: "gemini-2.5-flash",
      apiKeys: { google: "test-key" },
      testCommand: "npm test",
      maxHealAttempts: 4,
    };
    const provider = createProviderFromConfig(config);
    expect(provider.name).toBe("google");
    expect(provider.defaultModel).toBe("gemini-2.5-flash");
  });

  it("lists Google Gemini models from the provider endpoint", async () => {
    vi.stubGlobal("fetch", mockFetchOk({
      models: [
        { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
      ],
    }));
    const provider = createProviderFromConfig({
      provider: "google",
      apiKeys: { google: "test-key" },
      testCommand: "npm test",
      maxHealAttempts: 4,
    });

    await expect(provider.listModels?.()).resolves.toEqual(["gemini-2.5-flash"]);
  });

  it("lists Ollama models from the local runtime", async () => {
    vi.stubGlobal("fetch", mockFetchOk({
      models: [{ name: "deepseek-r1:8b" }, { model: "qwen3.5:4b" }],
    }));
    const provider = createProviderFromConfig({
      provider: "ollama",
      apiKeys: {},
      testCommand: "npm test",
      maxHealAttempts: 4,
    });

    await expect(provider.listModels?.()).resolves.toEqual(["deepseek-r1:8b", "qwen3.5:4b"]);
  });

  it("creates Ollama provider without API key", () => {
    const config: ResolvConfig = {
      provider: "ollama",
      apiKeys: {},
      testCommand: "npm test",
      maxHealAttempts: 4,
    };
    const provider = createProviderFromConfig(config);
    expect(provider.name).toBe("ollama");
  });
});

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadConfigModule = async () => {
  vi.resetModules();
  return await import("../config/config.js");
};

describe("config manager", () => {
  let configDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    configDir = fs.mkdtempSync(path.join(process.cwd(), "tmp-resolv-home-"));
    process.env.HOME = configDir;
  });

  afterEach(() => {
    process.env = originalEnv;
    if (fs.existsSync(configDir)) fs.rmSync(configDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it("loads saved config and applies defaults", async () => {
    const configPath = path.join(configDir, ".config", "resolv");
    fs.mkdirSync(configPath, { recursive: true });
    fs.writeFileSync(path.join(configPath, "config.json"), JSON.stringify({
      provider: "openai",
      model: "gpt-4o",
      apiKeys: { openai: "saved-key" },
      testCommand: "npm test",
      maxHealAttempts: 6,
    }));

    const { loadConfig } = await loadConfigModule();
    const config = loadConfig();

    expect(config.provider).toBe("openai");
    expect(config.model).toBe("gpt-4o");
    expect(config.apiKeys.openai).toBe("saved-key");
    expect(config.testCommand).toBe("npm test");
    expect(config.maxHealAttempts).toBe(6);
  });

  it("honors environment overrides for provider and keys", async () => {
    const configPath = path.join(configDir, ".config", "resolv");
    fs.mkdirSync(configPath, { recursive: true });
    fs.writeFileSync(path.join(configPath, "config.json"), JSON.stringify({
      provider: "anthropic",
      apiKeys: { anthropic: "saved-key" },
    }));

    process.env.OPENAI_API_KEY = "env-openai-key";
    process.env.RESOLV_PROVIDER = "openai";
    process.env.RESOLV_MODEL = "gpt-4o";

    const { loadConfig } = await loadConfigModule();
    const config = loadConfig();

    expect(config.provider).toBe("openai");
    expect(config.apiKeys.openai).toBe("env-openai-key");
    expect(config.model).toBe("gpt-4o");
  });
});

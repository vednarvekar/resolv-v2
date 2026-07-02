import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadSessionModule = async () => {
  vi.resetModules();
  return await import("../packages/llm/session/persistence.js");
};

describe("session persistence", () => {
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

  it("removes sessions older than 24 hours", async () => {
    const { saveSession, listSessions } = await loadSessionModule();
    const history = [{ role: "user", content: [{ type: "text", text: "hello" }] }];

    saveSession("old", history as never, "openai", "gpt-4o", "/repo");
    saveSession("fresh", history as never, "openai", "gpt-4o", "/repo");

    const sessionsDir = path.join(configDir, ".config", "resolv", "sessions");
    const oldPath = path.join(sessionsDir, "old.json");
    const freshPath = path.join(sessionsDir, "fresh.json");
    const oldData = JSON.parse(fs.readFileSync(oldPath, "utf-8"));
    oldData.meta.updatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(oldPath, JSON.stringify(oldData, null, 2));

    const sessions = listSessions();

    expect(sessions.map((s) => s.id)).toEqual(["fresh"]);
    expect(fs.existsSync(oldPath)).toBe(false);
    expect(fs.existsSync(freshPath)).toBe(true);
  });
});

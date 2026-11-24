import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createFilesystemTools } from "../packages/llm/tools/filesystem-tools.js";
import { createRepoTools } from "../packages/llm/tools/repo-tools.js";
import { isProtectedPath } from "../packages/llm/tools/tool-utils.js";

describe("isProtectedPath", () => {
  it("blocks .env variants", () => {
    expect(isProtectedPath(".env")).toBe(true);
    expect(isProtectedPath(".env.production")).toBe(true);
    expect(isProtectedPath("nested/.env.local")).toBe(true);
  });

  it("blocks git internals and CI workflows", () => {
    expect(isProtectedPath(".git/config")).toBe(true);
    expect(isProtectedPath(".github/workflows/ci.yml")).toBe(true);
  });

  it("blocks lockfiles", () => {
    expect(isProtectedPath("package-lock.json")).toBe(true);
    expect(isProtectedPath("yarn.lock")).toBe(true);
  });

  it("allows normal source files", () => {
    expect(isProtectedPath("src/index.ts")).toBe(false);
    expect(isProtectedPath("README.md")).toBe(false);
  });
});

describe("write_file guardrails", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "resolv-guardrail-"));
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  function getWriteTool() {
    const tools = createFilesystemTools(repoRoot, new Set());
    const tool = tools.find((t) => t.name === "write_file");
    if (!tool) throw new Error("write_file tool not found");
    return tool;
  }

  it("refuses to write .env", async () => {
    const result = await getWriteTool().execute({ path: ".env", content: "SECRET=1" });
    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/protected path/i);
    expect(fs.existsSync(path.join(repoRoot, ".env"))).toBe(false);
  });

  it("refuses to write CI workflow files", async () => {
    const result = await getWriteTool().execute({
      path: ".github/workflows/ci.yml",
      content: "on: push",
    });
    expect(result.isError).toBe(true);
  });

  it("refuses oversized writes", async () => {
    const big = "a".repeat(300_000);
    const result = await getWriteTool().execute({ path: "src/big.ts", content: big });
    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/byte limit/i);
  });

  it("allows normal source writes", async () => {
    const result = await getWriteTool().execute({ path: "src/index.ts", content: "export {}" });
    expect(result.isError).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, "src/index.ts"))).toBe(true);
  });
});

describe("run_tests guardrail", () => {
  it("does not expose a command parameter to the model", () => {
    const tools = createRepoTools(process.cwd(), "echo ok");
    const runTestsTool = tools.find((t) => t.name === "run_tests");
    expect(runTestsTool).toBeDefined();
    expect(runTestsTool!.inputSchema.properties ?? {}).toEqual({});
  });

  it("always runs the configured command regardless of tool input", async () => {
    const tools = createRepoTools(process.cwd(), "echo configured-command-ran");
    const runTestsTool = tools.find((t) => t.name === "run_tests")!;
    // Even if something upstream mistakenly passed a command-like field,
    // the tool signature takes no input, so there's nothing to inject.
    const result = await runTestsTool.execute({});
    expect(result.output).toMatch(/configured-command-ran/);
  });
});

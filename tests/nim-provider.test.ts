import { afterEach, describe, expect, it, vi } from "vitest";
import { NimProvider } from "../packages/providers/nim/nim-provider.js";

afterEach(() => vi.unstubAllGlobals());

describe("NVIDIA NIM diagnostics", () => {
  it("checks connectivity and model availability during activation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: "google/gemma-4-31b-it" }],
    }), { status: 200 })));

    await expect(new NimProvider("test-key").healthCheck("google/gemma-4-31b-it"))
      .resolves.toBeUndefined();
  });

  it("reports the underlying network error", async () => {
    const failure = new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(failure));

    await expect(new NimProvider("test-key").healthCheck("google/gemma-4-31b-it"))
      .rejects.toThrow(/fetch failed \(ENOTFOUND\).*integrate\.api\.nvidia\.com/);
  });
});

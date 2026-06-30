// packages/providers/nim/nim-provider.ts
// NVIDIA NIM — uses the shared OpenAI-compatible base with NIM-specific
// endpoint, timeout config, and model health check against the NIM catalog.

import { OpenAICompatProvider, type OpenAICompatConfig } from "../openai-compat/base-provider.js";
import { ProviderError } from "../../core/errors.js";

const NIM_BASE = "https://integrate.api.nvidia.com/v1";
const HEALTH_TIMEOUT_MS = 10_000;

function requestTimeoutMs(): number {
  const v = Number.parseInt(process.env.NIM_REQUEST_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(v) && v >= 5_000 ? v : 90_000;
}

export class NimProvider extends OpenAICompatProvider {
  constructor(apiKey: string, model?: string) {
    const cfg: OpenAICompatConfig = {
      apiKey,
      baseUrl: NIM_BASE,
      providerName: "nim",
      defaultModel: model ?? "google/gemma-4-31b-it",
      defaultEmbeddingModel: "nvidia/nv-embedqa-e5-v5",
      defaultTemperature: 0.3,
      defaultMaxTokens: 4096,
      requestTimeoutMs: requestTimeoutMs(),
      healthCheckUrl: `${NIM_BASE}/models`,
    };
    super(cfg);
  }

  /** NIM health check: verify API key works and optionally that the model is in the catalog. */
  override async healthCheck(model?: string): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${NIM_BASE}/models`, {
        headers: { Authorization: `Bearer ${this.cfg.apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
    } catch (cause) {
      let detail = "";
      if (cause instanceof Error) {
        detail = cause.message;
        const causeCode = (cause as Error & { cause?: unknown }).cause;
        if (causeCode && typeof causeCode === "object" && "code" in causeCode) {
          detail += ` (${String((causeCode as { code?: string }).code)})`;
        }
      } else {
        detail = String(cause);
      }
      throw new ProviderError(
        `Cannot reach NVIDIA NIM (${detail}). Check DNS, VPN/proxy, and access to integrate.api.nvidia.com`,
        "nim"
      );
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new ProviderError(
        `NVIDIA NIM API key check failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
        "nim",
        res.status
      );
    }

    if (!model) return;

    try {
      const payload = (await res.json()) as { data?: Array<{ id?: string }> };
      if (payload?.data?.length && !payload.data.some((m) => m.id === model)) {
        throw new ProviderError(
          `NVIDIA NIM model "${model}" is not available. Run /model to pick an available model.`,
          "nim"
        );
      }
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      // Catalog parse failed — not fatal, continue
    }
  }
}

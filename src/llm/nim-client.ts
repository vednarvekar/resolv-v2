const NIM_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

/** Rough chars-per-token heuristic used only for a pre-flight sanity check, not exact billing. */
const CHARS_PER_TOKEN_ESTIMATE = 4;
const MAX_PROMPT_TOKENS_ESTIMATE = 24000; // leaves headroom under typical 32k-context NIM models

export interface NimChatOptions {
  prompt: string;
  apiKey: string;
  /** e.g. "meta/llama-3.3-70b-instruct", "nvidia/nemotron-4-340b-instruct" */
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface NimChatResult {
  content: string;
  raw: unknown;
}

/** Circuit breaker: refuses to fire a request that's almost certainly going to blow the context window. */
function assertPromptWithinBudget(prompt: string): void {
  const estimatedTokens = Math.ceil(prompt.length / CHARS_PER_TOKEN_ESTIMATE);
  if (estimatedTokens > MAX_PROMPT_TOKENS_ESTIMATE) {
    throw new Error(
      `Prompt too large (~${estimatedTokens} estimated tokens, limit ${MAX_PROMPT_TOKENS_ESTIMATE}). ` +
      `Reduce the number/size of relevant files included, or pick a model with a larger context window.`
    );
  }
}

/**
 * Calls NVIDIA NIM's OpenAI-compatible chat completions endpoint.
 * Requires an API key from https://build.nvidia.com (free tier available).
 */
export async function callNim(options: NimChatOptions): Promise<NimChatResult> {
  assertPromptWithinBudget(options.prompt);

  const response = await fetch(NIM_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      messages: [{ role: "user", content: options.prompt }],
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 2048,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`NVIDIA NIM request failed: ${response.status} ${errText}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content ?? "";

  return { content, raw: data };
}

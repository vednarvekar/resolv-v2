const NIM_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

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

/**
 * Calls NVIDIA NIM's OpenAI-compatible chat completions endpoint.
 * Requires an API key from https://build.nvidia.com (free tier available).
 */
export async function callNim(options: NimChatOptions): Promise<NimChatResult> {
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

/**
 * Same call, but feeds a failing test's error output back in so the model
 * can correct its own previous fix. Used by the self-healing loop.
 */
export async function callNimWithErrorFeedback(
  basePrompt: string,
  previousAttempt: string,
  testError: string,
  apiKey: string,
  model: string
): Promise<NimChatResult> {
  const retryPrompt = `${basePrompt}

YOUR PREVIOUS ATTEMPT:
${previousAttempt}

THAT ATTEMPT FAILED THE TEST SUITE WITH THIS ERROR:
${testError}

Fix the code so the tests pass. Keep following all the rules above — reuse existing helpers, match repo style, no new dependencies. Return only the corrected code.`;

  return callNim({ prompt: retryPrompt, apiKey, model });
}
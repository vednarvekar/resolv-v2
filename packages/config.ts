export interface ResolvConfig {
  nimApiKey: string;
  githubToken?: string;
  nimModel: string;
  testCommand: string;
  maxHealAttempts: number;
}

const DEFAULT_MODEL = "meta/llama-3.3-70b-instruct";
const DEFAULT_TEST_COMMAND = "npm test";
const DEFAULT_MAX_ATTEMPTS = 4;

export function loadConfig(): ResolvConfig {
  const nimApiKey = process.env.NVIDIA_API_KEY || "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";

  if (!nimApiKey) {
    throw new Error(
      "Missing NVIDIA_API_KEY. Get a free key at https://build.nvidia.com and set it as an environment variable."
    );
  }

  return {
    nimApiKey,
    ...(process.env.GITHUB_TOKEN ? { githubToken: process.env.GITHUB_TOKEN } : {}),
    nimModel: process.env.RESOLV_MODEL ?? DEFAULT_MODEL,
    testCommand: process.env.RESOLV_TEST_COMMAND ?? DEFAULT_TEST_COMMAND,
    maxHealAttempts: process.env.RESOLV_MAX_ATTEMPTS
      ? Number(process.env.RESOLV_MAX_ATTEMPTS)
      : DEFAULT_MAX_ATTEMPTS,
  };
}
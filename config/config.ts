import dotenv from "dotenv"
dotenv.config({ quiet: true });

export interface ResolvConfig {
  githubToken?: string;
  model?: string;
  testCommand: string;
  maxHealAttempts: number;
}

const DEFAULT_TEST_COMMAND = "npm test";
const DEFAULT_MAX_ATTEMPTS = 20;

export function loadConfig(): ResolvConfig {
  return {
    githubToken: process.env.GITHUB_TOKEN,
    model: process.env.RESOLV_MODEL,
    testCommand: process.env.RESOLV_TEST_COMMAND ?? DEFAULT_TEST_COMMAND,
    maxHealAttempts: process.env.RESOLV_MAX_ATTEMPTS
      ? Number(process.env.RESOLV_MAX_ATTEMPTS)
      : DEFAULT_MAX_ATTEMPTS,
  };
}

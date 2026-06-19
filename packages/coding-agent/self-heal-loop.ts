import type { Provider } from "../providers/provider.js";
import { buildRetryPrompt } from "../llm/prompt-builder.js";
import { parseFileChanges, applyFileChanges } from "./apply-fix.js";
import { runTests, truncateForPrompt } from "./run-tests.js";
import { Msg } from "../core/types.js";

export interface SelfHealOptions {
  repoRoot: string;
  prompt: string;
  provider: Provider;
  model?: string;
  testCommand: string;
  maxAttempts?: number;
  maxTokens?: number;
}

export interface SelfHealResult {
  success: boolean;
  attempts: number;
  filesChanged: string[];
  finalOutput: string;
  lastLlmResponse: string;
  noParseableChange: boolean;
}

export async function runSelfHealLoop(options: SelfHealOptions): Promise<SelfHealResult> {
  const maxAttempts = options.maxAttempts ?? 4;
  let attempt = 0;
  let lastResponse = "";
  let filesChanged: string[] = [];
  let lastTestOutput = "";
  let everParsed = false;

  async function callProvider(prompt: string): Promise<string> {
    const response = await options.provider.chat({
      messages: [Msg.user(prompt)],
      model: options.model,
      maxTokens: options.maxTokens ?? 4096,
    });
    const textBlock = response.message.content.find((b) => b.type === "text");
    return textBlock?.type === "text" ? textBlock.text : "";
  }

  attempt++;
  lastResponse = await callProvider(options.prompt);
  filesChanged = applyGeneratedFix(options.repoRoot, lastResponse);
  if (filesChanged.length > 0) everParsed = true;

  let testResult = filesChanged.length > 0
    ? runTests(options.repoRoot, options.testCommand)
    : { passed: false, output: "Model response contained no parseable SEARCH/REPLACE blocks — nothing was applied." };
  lastTestOutput = testResult.output;

  while (!testResult.passed && attempt < maxAttempts) {
    attempt++;
    const retryPrompt = buildRetryPrompt(options.prompt, lastResponse, truncateForPrompt(testResult.output));
    lastResponse = await callProvider(retryPrompt);
    filesChanged = applyGeneratedFix(options.repoRoot, lastResponse);
    if (filesChanged.length > 0) everParsed = true;

    testResult = filesChanged.length > 0
      ? runTests(options.repoRoot, options.testCommand)
      : { passed: false, output: "Model response contained no parseable SEARCH/REPLACE blocks — nothing was applied." };
    lastTestOutput = testResult.output;
  }

  return {
    success: testResult.passed,
    attempts: attempt,
    filesChanged,
    finalOutput: lastTestOutput,
    lastLlmResponse: lastResponse,
    noParseableChange: !everParsed,
  };
}

function applyGeneratedFix(repoRoot: string, llmResponse: string): string[] {
  const changes = parseFileChanges(llmResponse, repoRoot);
  if (changes.length === 0) return [];
  return applyFileChanges(repoRoot, changes);
}
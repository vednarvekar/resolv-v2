import { callNim, callNimWithErrorFeedback } from "../llm/nim-client.js";
import { parseFileChanges, applyFileChanges } from "./apply-fix.js";
import { runTests, truncateForPrompt } from "./run-tests.js";

export interface SelfHealOptions {
  repoRoot: string;
  prompt: string;
  apiKey: string;
  model: string;
  testCommand: string;
  maxAttempts?: number;
}

export interface SelfHealResult {
  success: boolean;
  attempts: number;
  filesChanged: string[];
  finalOutput: string;
  lastLlmResponse: string;
}

/**
 * The self-healing loop: ask the LLM for a fix, apply it, run the test command.
 * If tests fail, feed the error back to the LLM and retry, up to maxAttempts.
 */
export async function runSelfHealLoop(options: SelfHealOptions): Promise<SelfHealResult> {
  const maxAttempts = options.maxAttempts ?? 4;

  let attempt = 0;
  let lastResponse = "";
  let filesChanged: string[] = [];
  let lastTestOutput = "";

  // first attempt — fresh fix from the base prompt
  attempt++;
  const first = await callNim({ prompt: options.prompt, apiKey: options.apiKey, model: options.model });
  lastResponse = first.content;
  filesChanged = applyGeneratedFix(options.repoRoot, lastResponse);

  let testResult = runTests(options.repoRoot, options.testCommand);
  lastTestOutput = testResult.output;

  while (!testResult.passed && attempt < maxAttempts) {
    attempt++;

    const retry = await callNimWithErrorFeedback(
      options.prompt,
      lastResponse,
      truncateForPrompt(testResult.output),
      options.apiKey,
      options.model
    );
    lastResponse = retry.content;
    filesChanged = applyGeneratedFix(options.repoRoot, lastResponse);

    testResult = runTests(options.repoRoot, options.testCommand);
    lastTestOutput = testResult.output;
  }

  return {
    success: testResult.passed,
    attempts: attempt,
    filesChanged,
    finalOutput: lastTestOutput,
    lastLlmResponse: lastResponse,
  };
}

function applyGeneratedFix(repoRoot: string, llmResponse: string): string[] {
  const changes = parseFileChanges(llmResponse);
  if (changes.length === 0) {
    // model didn't follow the ```file:path``` format — nothing to apply this round
    return [];
  }
  return applyFileChanges(repoRoot, changes);
}
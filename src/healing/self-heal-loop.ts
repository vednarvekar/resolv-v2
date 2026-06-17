import { callNim } from "../llm/nim-client.js";
import { buildRetryPrompt } from "../llm/prompt-builder.js";
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
  /** true if the LLM never produced a parseable file change on any attempt */
  noParseableChange: boolean;
}

/**
 * The self-healing loop: ask the LLM for a fix, apply it, run the test command.
 * If tests fail, feed the error back to the LLM (sliding-window prompt, not
 * full history) and retry, up to maxAttempts.
 */
export async function runSelfHealLoop(options: SelfHealOptions): Promise<SelfHealResult> {
  const maxAttempts = options.maxAttempts ?? 4;

  let attempt = 0;
  let lastResponse = "";
  let filesChanged: string[] = [];
  let lastTestOutput = "";
  let everParsed = false;

  attempt++;
  const first = await callNim({ prompt: options.prompt, apiKey: options.apiKey, model: options.model });
  lastResponse = first.content;
  filesChanged = applyGeneratedFix(options.repoRoot, lastResponse);
  if (filesChanged.length > 0) everParsed = true;

  let testResult = filesChanged.length > 0
    ? runTests(options.repoRoot, options.testCommand)
    : { passed: false, output: "Model response contained no parseable SEARCH/REPLACE or file blocks — nothing was applied." };
  lastTestOutput = testResult.output;

  while (!testResult.passed && attempt < maxAttempts) {
    attempt++;

    const retryPrompt = buildRetryPrompt(options.prompt, lastResponse, truncateForPrompt(testResult.output));
    const retry = await callNim({ prompt: retryPrompt, apiKey: options.apiKey, model: options.model });
    lastResponse = retry.content;
    filesChanged = applyGeneratedFix(options.repoRoot, lastResponse);
    if (filesChanged.length > 0) everParsed = true;

    testResult = filesChanged.length > 0
      ? runTests(options.repoRoot, options.testCommand)
      : { passed: false, output: "Model response contained no parseable SEARCH/REPLACE or file blocks — nothing was applied." };
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

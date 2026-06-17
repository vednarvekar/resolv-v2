import { execSync } from "node:child_process";

export interface TestResult {
  passed: boolean;
  output: string;
}

/**
 * Runs the repo's test command (e.g. "npm test") and captures stdout+stderr.
 * Never throws — a failing test is a normal, expected outcome here, not an
 * exceptional one, so it's reported back as { passed: false, output }.
 */
export function runTests(repoRoot: string, testCommand: string): TestResult {
  try {
    const output = execSync(testCommand, {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 1000 * 60 * 5, // 5 minute hard cap so a hung test suite doesn't stall the loop
    });
    return { passed: true, output };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const output = [e.stdout, e.stderr].filter(Boolean).join("\n") || e.message || "Unknown test failure";
    return { passed: false, output };
  }
}

/** Trims test output down to something reasonable to feed back into the LLM prompt. */
export function truncateForPrompt(output: string, maxChars = 4000): string {
  if (output.length <= maxChars) return output;
  // keep the tail — that's where the actual assertion failure usually is
  return `...(truncated)...\n${output.slice(-maxChars)}`;
}

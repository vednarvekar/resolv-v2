import fs from "node:fs";
import path from "node:path";
import type { EvalCase } from "../types.js";

// Deliberately trivial: an off-by-one in a sum function, with a failing
// test that names the function and the expected value. This isolates
// "can the agent read a failing test, find the bug, and fix it" from
// harder judgment calls — a good smoke test to run on every provider
// before trusting it with anything bigger.
export const trivialBugFix: EvalCase = {
  id: "trivial-bug-fix",
  description: "Fix an off-by-one bug in sumRange so the failing test passes",
  category: "capability",
  testCommand: "node --test test.mjs",
  maxToolCallRounds: 12,
  fixture: {
    files: {
      "sum.mjs": `export function sumRange(start, end) {
  // BUG: should be <= end, this excludes the last number
  let total = 0;
  for (let i = start; i < end; i++) {
    total += i;
  }
  return total;
}
`,
      "test.mjs": `import { test } from "node:test";
import assert from "node:assert";
import { sumRange } from "./sum.mjs";

test("sumRange includes the end value", () => {
  assert.strictEqual(sumRange(1, 5), 15); // 1+2+3+4+5
});
`,
    },
  },
  task: [
    "There's a bug in sumRange in sum.mjs — the test in test.mjs is failing.",
    "Read the failing test, find the bug, fix it, and run the tests to confirm it passes.",
    "Do not change the test file.",
  ].join(" "),
  assert: async ({ repoRoot, toolCallLog }) => {
    const failures: string[] = [];

    const sumPath = path.join(repoRoot, "sum.mjs");
    if (!fs.existsSync(sumPath)) {
      failures.push("sum.mjs no longer exists");
      return failures;
    }
    const content = fs.readFileSync(sumPath, "utf-8");
    if (content.includes("i < end")) {
      failures.push("sum.mjs still contains the buggy 'i < end' condition");
    }

    const testPath = path.join(repoRoot, "test.mjs");
    const testContent = fs.readFileSync(testPath, "utf-8");
    if (!testContent.includes("sumRange(1, 5), 15")) {
      failures.push("test.mjs was modified — the agent was told not to touch it");
    }

    const ranRunTests = toolCallLog.some((c) => c.name === "run_tests");
    if (!ranRunTests) {
      failures.push("agent never called run_tests to verify its fix");
    }

    return failures;
  },
};

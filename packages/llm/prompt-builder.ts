import fs from "node:fs";
import path from "node:path";
import type { DNAProfile } from "../dna/types.js";
import type { GitHubIssue } from "../context-agent/github/fetch-issue.js";
import type { FixPlan } from "../planner/planner.js";
import type { IssueMapping } from "../context-agent/issue-mapper.js";

/** Hard ceilings so a single prompt can't blow the model's context window. */
const MAX_FILES_TO_INCLUDE = 5;
const MAX_CHARS_PER_FILE = 6000;
const MAX_TOTAL_SOURCE_CHARS = 20000;

const RESPONSE_FORMAT_INSTRUCTIONS = `
RESPONSE FORMAT — follow exactly, this is machine-parsed:

For each file you change, output one block:

\`\`\`file:relative/path/to/file.ts
<exact existing code to find, copied verbatim from the file shown above>
<the new code that replaces it>
\`\`\`

Rules for this format:
- The SEARCH text must match the existing file content character-for-character (including whitespace/indentation) so it can be located and replaced.
- Keep each SEARCH block as small as possible — only the lines that actually change, plus 1-2 lines of surrounding context if needed for uniqueness. Do NOT paste the whole file.
- You may include multiple SEARCH/REPLACE blocks for the same file, or blocks for multiple files.
- Only use a full-file dump (no SEARCH/REPLACE markers, just the new file content directly inside the \`\`\`file:path block) when creating a brand new file that doesn't exist yet.
- Do not include any prose, explanation, or markdown outside these blocks.
`.trim();

/** Reads a relevant file's content, truncated, so the model has real text to SEARCH against. */
function readFileSnippet(repoRoot: string, relativePath: string): string | null {
  try {
    const absPath = path.resolve(repoRoot, relativePath);
    const content = fs.readFileSync(absPath, "utf-8");
    if (content.length <= MAX_CHARS_PER_FILE) return content;
    return `${content.slice(0, MAX_CHARS_PER_FILE)}\n...(truncated, file continues)...`;
  } catch {
    return null;
  }
}

function buildSourceContext(repoRoot: string, relevantFiles: string[]): string {
  const chosen = relevantFiles.slice(0, MAX_FILES_TO_INCLUDE);
  let budget = MAX_TOTAL_SOURCE_CHARS;
  const sections: string[] = [];

  for (const filePath of chosen) {
    if (budget <= 0) break;
    const snippet = readFileSnippet(repoRoot, filePath);
    if (!snippet) continue;

    const clipped = snippet.slice(0, Math.max(0, budget));
    budget -= clipped.length;

    sections.push(`--- ${filePath} ---\n${clipped}`);
  }

  return sections.length > 0 ? sections.join("\n\n") : "(no file contents available — relevant files list was empty or unreadable)";
}

export function buildPrompt(
  issue: GitHubIssue,
  dna: DNAProfile,
  mapping: IssueMapping,
  plan: FixPlan,
  repoRoot: string,
  refinedFiles?: string[]
): string {
  const filesToShow = refinedFiles && refinedFiles.length > 0 ? refinedFiles : mapping.relevantFiles;

  const recentComments = issue.comments
    .slice(-3)
    .map((c) => `- ${c.author}: ${c.body.slice(0, 300)}`)
    .join("\n");

  const dominantErrorStyle = mostCommon(dna.errorPatterns.map((e) => e.style)) ?? "try-catch";
  const dominantAsyncStyle = mostCommon(dna.asyncPatterns.map((p) => p.dominantStyle)) ?? "async-await";

  const topHelpers = dna.helpers.slice(0, 15).map((h) => `${h.name} (used ${h.usages}x)`).join(", ");

  const sourceContext = buildSourceContext(repoRoot, filesToShow);

  return `
You are fixing a GitHub issue inside an existing repository. You must behave like a senior engineer on this exact codebase, not a generic AI tool.

ISSUE TITLE:
${issue.title}

ISSUE DESCRIPTION:
${issue.body}

RECENT DISCUSSION:
${recentComments || "(no comments)"}

RELEVANT FILES:
${filesToShow.join("\n") || "(none matched — inspect the repo structure below)"}

RELEVANT FUNCTIONS:
${mapping.relevantFunctions.join("\n") || "(none matched)"}

ACTUAL FILE CONTENTS (use this exact text for SEARCH blocks below):
${sourceContext}

REPO STYLE PROFILE (you MUST match these):
- Naming convention: ${dna.naming.dominantStyle}
- Error handling style: ${dominantErrorStyle}
- Async style: ${dominantAsyncStyle}
- Frequently reused helpers: ${topHelpers || "(none detected)"}

PLAN:
${plan.steps.map((step) => `${step.order}. ${step.action}`).join("\n")}

IMPORTANT RULES:
- Reuse existing helpers listed above whenever possible — do not write a new version of something that already exists.
- Match the naming convention (${dna.naming.dominantStyle}) and error handling style (${dominantErrorStyle}) exactly.
- Match the async style (${dominantAsyncStyle}) already used in this codebase.
- Do not introduce new external dependencies.
- Do not rewrite unrelated code.

${RESPONSE_FORMAT_INSTRUCTIONS}
`.trim();
}

/**
 * Builds the retry prompt for the self-heal loop with a sliding window —
 * only the most recent failure is included, not the full attempt history.
 * This keeps prompt size roughly constant across retries instead of growing
 * with every failed attempt (which would otherwise risk exceeding the
 * model's context window after a few loops).
 */
export function buildRetryPrompt(
  basePrompt: string,
  previousAttempt: string,
  testError: string,
  maxErrorChars = 3000,
  maxPreviousAttemptChars = 4000
): string {
  const clippedError = testError.length > maxErrorChars
    ? `...(truncated)...\n${testError.slice(-maxErrorChars)}`
    : testError;

  const clippedAttempt = previousAttempt.length > maxPreviousAttemptChars
    ? `${previousAttempt.slice(0, maxPreviousAttemptChars)}\n...(truncated)...`
    : previousAttempt;

  return `${basePrompt}

YOUR MOST RECENT ATTEMPT (previous attempts before this are not shown to keep this prompt short):
${clippedAttempt}

THAT ATTEMPT FAILED THE TEST SUITE WITH THIS ERROR:
${clippedError}

Fix the code so the tests pass. Keep following all the rules and response format above — reuse existing helpers, match repo style, no new dependencies, SEARCH/REPLACE blocks only.`;
}

function mostCommon<T extends string>(values: T[]): T | undefined {
  if (values.length === 0) return undefined;
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

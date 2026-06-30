// packages/llm/prompt-builder.ts
// Builds the LLM prompt from issue context + slimmed DNA profile.
// File contents are still included in full — that's what the LLM needs.
// Everything else is summarized, not dumped raw.

import fs from "node:fs";
import path from "node:path";
import type { DNAProfile } from "../dna/types.js";
import type { GitHubIssue } from "../context-agent/github/fetch-issue.js";
import type { FixPlan } from "../planner/planner.js";
import type { IssueMapping } from "../context-agent/issue-mapper.js";

const MAX_FILES_TO_INCLUDE = 5;
const MAX_CHARS_PER_FILE = 4000;
const MAX_TOTAL_SOURCE_CHARS = 15000;

const RESPONSE_FORMAT_INSTRUCTIONS = `
RESPONSE FORMAT — machine-parsed, follow exactly:

For each file you change:

\`\`\`file:relative/path/to/file.ts
<<<<<<< SEARCH
<exact existing code — copied verbatim, character-for-character>
=======
<new replacement code>
>>>>>>> REPLACE
\`\`\`

Rules:
- SEARCH must match the file's actual content exactly (whitespace included).
- Keep SEARCH as small as possible — only the changing lines plus 1-2 context lines.
- Multiple SEARCH/REPLACE blocks per file are fine.
- For new files, omit the SEARCH/REPLACE markers and put the full content directly inside the \`\`\`file: block.
- No prose, explanation, or markdown outside these blocks.
`.trim();

function readFileSnippet(repoRoot: string, relativePath: string): string | null {
  try {
    const absPath = path.resolve(repoRoot, relativePath);
    const content = fs.readFileSync(absPath, "utf-8");
    return content.length <= MAX_CHARS_PER_FILE
      ? content
      : `${content.slice(0, MAX_CHARS_PER_FILE)}\n...(truncated)...`;
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

  return sections.length > 0
    ? sections.join("\n\n")
    : "(no file contents available)";
}

export function buildPrompt(
  issue: GitHubIssue,
  dna: DNAProfile,
  mapping: IssueMapping,
  plan: FixPlan,
  repoRoot: string,
  refinedFiles?: string[]
): string {
  const filesToShow = refinedFiles?.length ? refinedFiles : mapping.relevantFiles;
  const recentComments = issue.comments
    .slice(-3)
    .map((c) => `- ${c.author}: ${c.body.slice(0, 300)}`)
    .join("\n");

  const topHelpers = dna.helpers.slice(0, 10).map((h) => `${h.name} (${h.usages}x)`).join(", ");
  const sourceContext = buildSourceContext(repoRoot, filesToShow);

  return `You are fixing a GitHub issue inside an existing repository. Match the existing code style exactly — do not write it "your own way."

ISSUE: ${issue.title}

DESCRIPTION:
${issue.body}

RECENT COMMENTS:
${recentComments || "(none)"}

TARGET FILES:
${filesToShow.join("\n") || "(none matched — inspect repo structure)"}

FILE CONTENTS (use this exact text for SEARCH blocks):
${sourceContext}

REPO STYLE (confidence = how much of the repo actually follows this — below 70% means it's not a strict convention, use judgment rather than forcing it):
- Naming: ${dna.dominantNaming} (${Math.round(dna.namingConfidence * 100)}% confidence)
- Async: ${dna.dominantAsyncStyle} (${Math.round(dna.asyncConfidence * 100)}% confidence)
- Error handling: ${dna.dominantErrorStyle} (${Math.round(dna.errorConfidence * 100)}% confidence)
- Shared helpers (prefer reusing these): ${topHelpers || "(none detected)"}

PLAN:
${plan.steps.map((s) => `${s.order}. ${s.action}`).join("\n")}

RULES:
- Reuse existing helpers above — do not reimplement them.
- Match the repo's naming, error handling, and async styles where confidence is high (≥70%). Where confidence is low, follow the convention already used in the specific file(s) you're editing instead of the repo-wide average.
- No new external dependencies.
- Minimal changes — only what the fix requires.

${RESPONSE_FORMAT_INSTRUCTIONS}`.trim();
}

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

YOUR LAST ATTEMPT:
${clippedAttempt}

TEST FAILURE:
${clippedError}

Fix the code so tests pass. Same rules and response format as above.`;
}
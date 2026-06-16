import type { DNAProfile } from "../dna/types.js";
import type { GitHubIssue } from "../github/fetch-issue.js";
import type { FixPlan } from "../planner/planner.js";
import type { IssueMapping } from "../issue/issue-mapper.js";

export function buildPrompt(
  issue: GitHubIssue,
  dna: DNAProfile,
  mapping: IssueMapping,
  plan: FixPlan
): string {
  const recentComments = issue.comments
    .slice(-3)
    .map((c) => `- ${c.author}: ${c.body.slice(0, 300)}`)
    .join("\n");

  const dominantErrorStyle = mostCommon(dna.errorPatterns.map((e) => e.style)) ?? "try-catch";
  const dominantAsyncStyle = mostCommon(dna.asyncPatterns.map((p) => p.dominantStyle)) ?? "async-await";

  const topHelpers = dna.helpers.slice(0, 15).map((h) => `${h.name} (used ${h.usages}x)`).join(", ");

  return `
You are fixing a GitHub issue inside an existing repository. You must behave like a senior engineer on this exact codebase, not a generic AI tool.

ISSUE TITLE:
${issue.title}

ISSUE DESCRIPTION:
${issue.body}

RECENT DISCUSSION:
${recentComments || "(no comments)"}

RELEVANT FILES:
${mapping.relevantFiles.join("\n") || "(none matched — inspect the repo structure below)"}

RELEVANT FUNCTIONS:
${mapping.relevantFunctions.join("\n") || "(none matched)"}

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
- Return only the code changes needed, as a unified diff or full file contents per changed file.

REPOSITORY DNA SUMMARY:
Functions: ${dna.functions.length}
Helpers: ${dna.helpers.length}
Call Graph Nodes: ${dna.callGraph.length}
Dependencies: ${dna.dependencies.length}
`;
}

function mostCommon<T extends string>(values: T[]): T | undefined {
  if (values.length === 0) return undefined;
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}
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

  return `
You are fixing a GitHub issue inside an existing repository.

ISSUE TITLE:
${issue.title}

ISSUE DESCRIPTION:
${issue.body}

RELEVANT FILES:
${mapping.relevantFiles.join("\n")}

RELEVANT FUNCTIONS:
${mapping.relevantFunctions.join("\n")}

RELEVANT HELPERS:
${mapping.relevantHelpers.join("\n")}

PLAN:
${plan.steps.map(step => `${step.order}. ${step.action}`).join("\n")}

IMPORTANT RULES:
- Reuse existing helpers whenever possible.
- Follow existing repository patterns.
- Do not introduce new dependencies.
- Do not rewrite unrelated code.
- Match the existing code style.
- Return only the code changes needed.

REPOSITORY DNA SUMMARY:

Functions: ${dna.functions.length}
Helpers: ${dna.helpers.length}
Call Graph Nodes: ${dna.callGraph.length}
`;
}
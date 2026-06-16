import type { DNAProfile } from "../dna/types.js";
import type { GitHubIssue } from "../github/fetch-issue.js";

export interface IssueMapping {
  keywords: string[];
  relevantFiles: string[];
  relevantFunctions: string[];
  relevantHelpers: string[];
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "when", "where",
  "into", "cannot", "can't", "does", "doesnt", "doesn't", "issue", "error",
  "bug", "fix", "have", "should", "would", "could", "there", "their",
]);

export function mapIssueToDNA(issue: GitHubIssue, dna: DNAProfile): IssueMapping {
  // include comments in keyword extraction — maintainers often clarify root cause there
  const fullText = [issue.title, issue.body, ...issue.comments.map((c) => c.body)].join("\n");
  const keywords = extractKeywords(fullText);

  const relevantFiles = dna.files
    .filter((file) => keywords.some((keyword) => file.relativePath.toLowerCase().includes(keyword)))
    .map((file) => file.relativePath);

  const relevantFunctions = dna.functions
    .filter((fn) => keywords.some((keyword) => fn.name.toLowerCase().includes(keyword)))
    .map((fn) => fn.name);

  const relevantHelpers = dna.helpers
    .filter((helper) => keywords.some((keyword) => helper.name.toLowerCase().includes(keyword)))
    .map((helper) => helper.name);

  return { keywords, relevantFiles, relevantFunctions, relevantHelpers };
}

function extractKeywords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
    ),
  ];
}
// packages/context-agent/issue-mapper.ts
// Maps issue keywords to relevant files and functions from the DNA profile.

import type { DNAProfile } from "../dna/types.js";
import type { GitHubIssue } from "./github/fetch-issue.js";

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

function extractKeywords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    ),
  ];
}

export function mapIssueToDNA(issue: GitHubIssue, dna: DNAProfile): IssueMapping {
  const fullText = [issue.title, issue.body, ...issue.comments.map((c) => c.body)].join("\n");
  const keywords = extractKeywords(fullText);

  const relevantFiles = dna.files
    .filter((f) => keywords.some((k) => f.relativePath.toLowerCase().includes(k)))
    .map((f) => f.relativePath);

  const relevantFunctions = dna.functions
    .filter((fn) => keywords.some((k) => fn.name.toLowerCase().includes(k)))
    .map((fn) => fn.name);

  const relevantHelpers = dna.helpers
    .filter((h) => keywords.some((k) => h.name.toLowerCase().includes(k)))
    .map((h) => h.name);

  return { keywords, relevantFiles, relevantFunctions, relevantHelpers };
}
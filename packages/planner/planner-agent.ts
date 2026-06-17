import { callNim } from "../llm/nim-client.js";
import type { DNAProfile } from "../dna/types.js";
import type { GitHubIssue } from "../github/fetch-issue.js";
import type { SemanticMatch } from "../semantic/file-index.js";
import type { IssueMapping } from "../issue/issue-mapper.js";

export interface AgentPlan {
  targetFiles: string[];
  targetFunctions: string[];
  reasoning: string;
  /** true if the model's JSON output failed to parse and we fell back to the keyword mapping */
  usedFallback: boolean;
}

/**
 * A planning subagent: a single, narrowly-scoped NIM call whose only job is
 * "given the issue and a candidate set of files/functions, decide which ones
 * actually need to change." This replaces pure substring/keyword matching
 * with judgment — keyword matching still runs first (in issue-mapper.ts) to
 * produce a candidate pool, and semantic search adds a second candidate pool,
 * but the LLM does the final filtering instead of "any file whose path
 * contains a issue keyword."
 */
export async function planTargets(
  issue: GitHubIssue,
  dna: DNAProfile,
  keywordMapping: IssueMapping,
  semanticMatches: SemanticMatch[],
  apiKey: string,
  model: string
): Promise<AgentPlan> {
  const candidateFiles = new Set<string>([
    ...keywordMapping.relevantFiles,
    ...semanticMatches.filter((m) => m.chunk.kind === "file").map((m) => m.chunk.relativePath),
  ]);

  const candidateFunctions = new Set<string>([
    ...keywordMapping.relevantFunctions,
    ...semanticMatches
      .filter((m) => m.chunk.kind === "function" && m.chunk.symbolName)
      .map((m) => `${m.chunk.symbolName} (${m.chunk.relativePath})`),
  ]);

  // nothing to reason about — skip the LLM call entirely and use whatever keyword matching found
  if (candidateFiles.size === 0 && candidateFunctions.size === 0) {
    return {
      targetFiles: keywordMapping.relevantFiles,
      targetFunctions: keywordMapping.relevantFunctions,
      reasoning: "No candidates found by keyword or semantic search; nothing for the planner to filter.",
      usedFallback: true,
    };
  }

  const prompt = `You are a planning agent. Given a GitHub issue and a candidate list of files/functions from a codebase, decide which ones actually need to change to fix the issue. Be conservative — only include files genuinely relevant to the fix, not tangentially related ones.

ISSUE TITLE: ${issue.title}
ISSUE BODY: ${issue.body.slice(0, 2000)}

CANDIDATE FILES:
${[...candidateFiles].join("\n") || "(none)"}

CANDIDATE FUNCTIONS:
${[...candidateFunctions].join("\n") || "(none)"}

Respond with ONLY valid JSON, no markdown, no prose, in exactly this shape:
{"targetFiles": ["path1", "path2"], "targetFunctions": ["fn1", "fn2"], "reasoning": "one or two sentences"}`;

  try {
    const result = await callNim({ prompt, apiKey, model, temperature: 0.1, maxTokens: 800 });
    const parsed = parsePlanResponse(result.content);
    if (parsed) return { ...parsed, usedFallback: false };
  } catch {
    // network/API failure — fall through to keyword-based fallback below
  }

  return {
    targetFiles: keywordMapping.relevantFiles,
    targetFunctions: keywordMapping.relevantFunctions,
    reasoning: "Planner agent call failed or returned unparseable output; fell back to keyword matching.",
    usedFallback: true,
  };
}

function parsePlanResponse(raw: string): Omit<AgentPlan, "usedFallback"> | null {
  // models sometimes wrap JSON in ```json fences despite instructions — strip if present
  const cleaned = raw.replace(/```json\s*|```\s*/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned) as {
      targetFiles?: unknown;
      targetFunctions?: unknown;
      reasoning?: unknown;
    };

    const targetFiles = Array.isArray(parsed.targetFiles)
      ? parsed.targetFiles.filter((f): f is string => typeof f === "string")
      : [];
    const targetFunctions = Array.isArray(parsed.targetFunctions)
      ? parsed.targetFunctions.filter((f): f is string => typeof f === "string")
      : [];
    const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "";

    return { targetFiles, targetFunctions, reasoning };
  } catch {
    return null;
  }
}

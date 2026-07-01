// packages/planner/planner-agent.ts
// LLM planning subagent: picks which candidate files actually need to change.

import type { DNAProfile } from "../dna/types.js";
import type { GitHubIssue } from "../context-agent/github/fetch-issue.js";
import type { SemanticMatch } from "../context-agent/semantic/file-index.js";
import type { IssueMapping } from "../context-agent/issue-mapper.js";
import type { Provider } from "../providers/provider.js";
import { Msg } from "../core/types.js";
import { chatWithTransientRetries } from "../llm/chat-with-retries.js";

export interface AgentPlan {
  targetFiles: string[];
  targetFunctions: string[];
  reasoning: string;
  usedFallback: boolean;
}

export async function planTargets(
  issue: GitHubIssue,
  dna: DNAProfile,
  keywordMapping: IssueMapping,
  semanticMatches: SemanticMatch[],
  provider: Provider,
  model?: string
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

  if (candidateFiles.size === 0 && candidateFunctions.size === 0) {
    return {
      targetFiles: keywordMapping.relevantFiles,
      targetFunctions: keywordMapping.relevantFunctions,
      reasoning: "No candidates from keyword or semantic search.",
      usedFallback: true,
    };
  }

  const prompt = `You are a planning agent. Given a GitHub issue and candidate files/functions, choose which ones actually need to change. Be conservative.

ISSUE: ${issue.title}
BODY: ${issue.body.slice(0, 1500)}

CANDIDATE FILES:
${[...candidateFiles].join("\n") || "(none)"}

CANDIDATE FUNCTIONS:
${[...candidateFunctions].join("\n") || "(none)"}

Respond ONLY with valid JSON:
{"targetFiles": ["path1"], "targetFunctions": ["fn1"], "reasoning": "one sentence"}`;

  try {
    const result = await chatWithTransientRetries(
      provider,
      { messages: [Msg.user(prompt)], model, temperature: 0.1, maxTokens: 600 },
      { retries: 1 },
    );
    const textBlock = result.message.content.find((b) => b.type === "text");
    const parsed = textBlock?.type === "text" ? parsePlanResponse(textBlock.text) : null;
    if (parsed) return { ...parsed, usedFallback: false };
  } catch {
    // fall through to keyword fallback
  }

  return {
    targetFiles: keywordMapping.relevantFiles,
    targetFunctions: keywordMapping.relevantFunctions,
    reasoning: "Planner call failed; fell back to keyword matching.",
    usedFallback: true,
  };
}

function parsePlanResponse(raw: string): Omit<AgentPlan, "usedFallback"> | null {
  const cleaned = raw.replace(/```json\s*|```\s*/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as { targetFiles?: unknown; targetFunctions?: unknown; reasoning?: unknown };
    return {
      targetFiles: Array.isArray(parsed.targetFiles) ? parsed.targetFiles.filter((f): f is string => typeof f === "string") : [],
      targetFunctions: Array.isArray(parsed.targetFunctions) ? parsed.targetFunctions.filter((f): f is string => typeof f === "string") : [],
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    };
  } catch {
    return null;
  }
}

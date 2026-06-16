import { parseIssueUrl } from "../github/parse-issue-url.js";
import { fetchIssue } from "../github/fetch-issue.js";

import { extractDNA } from "../dna/index.js";

import { mapIssueToDNA } from "../issue/issue-mapper.js";
import { createPlan } from "../planner/planner.js";

import { buildPrompt } from "../llm/build-prompt.js";
import { generateFix } from "../llm/generate-fix.js";

export async function solve(
  issueUrl: string,
  repoPath: string
) {

  const parsed =
    parseIssueUrl(issueUrl);

  const issue =
    await fetchIssue(
      parsed.owner,
      parsed.repo,
      parsed.issueNumber
    );

  const dna =
    await extractDNA(repoPath);

  const mapping =
    mapIssueToDNA(
      `${issue.title}\n${issue.body}`,
      dna
    );

  const plan =
    createPlan(
      issue.title,
      mapping
    );

  const prompt =
    buildPrompt(
      issue,
      dna,
      mapping,
      plan
    );

  const fix =
    await generateFix({
      prompt,
      apiKey: process.env.OPENROUTER_API_KEY!,
      model:
        "meta-llama/llama-3.3-70b-instruct"
    });

  console.log(fix);
}
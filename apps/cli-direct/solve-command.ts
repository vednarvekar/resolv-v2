import path from "node:path";
import chalk from "chalk";
import ora from "ora";

import { loadConfig } from "../../config/config.js";
import { parseIssueUrl } from "../../packages/context-agent/github/parse-issue-url.js";
import { fetchIssue } from "../../packages/context-agent/github/fetch-issue.js";
import { extractDNA } from "../../packages/dna/extract.js";
import { mapIssueToDNA } from "../../packages/context-agent/issue-mapper.js";
import { createPlan } from "../../packages/planner/planner.js";
import { planTargets } from "../../packages/planner/planner-agent.js";
import { buildPrompt } from "../../packages/llm/prompt-builder.js";
import { buildSemanticIndex, semanticSearch } from "../../packages/context-agent/semantic/file-index.js";
import { createBranch, branchExists, assertCleanWorkingDirectory } from "../../packages/coding-agent/git/create-branch.js";
import { checkoutBranch, getCurrentBranch } from "../../packages/coding-agent/git/checkout.js";
import { commitChanges } from "../../packages/coding-agent/git/commit.js";
import { openPullRequest, getDefaultBranch } from "../../packages/coding-agent/git/push-and-pr.js";
import { runSelfHealLoop } from "../../packages/coding-agent/self-heal-loop.js";
import { createProviderFromEnv } from "../../packages/providers/register.js";

export interface SolveOptions {
  issueUrl: string;
  repoPath: string;
  /** skip the semantic-search + planner-agent step and use plain keyword matching only (faster, no embedding cost) */
  noSemantic?: boolean;
}

export async function solve(options: SolveOptions): Promise<void> {
  const config = loadConfig();
  const provider = createProviderFromEnv();
  const repoPath = path.resolve(options.repoPath);

  const guardSpinner = ora("Checking working directory is clean...").start();
  try {
    assertCleanWorkingDirectory();
    guardSpinner.succeed("Working directory is clean");
  } catch (err) {
    guardSpinner.fail((err as Error).message);
    process.exitCode = 1;
    return;
  }

  const parsed = parseIssueUrl(options.issueUrl);

  const issueSpinner = ora(`Fetching issue #${parsed.issueNumber} from ${parsed.owner}/${parsed.repo}...`).start();
  const issue = await fetchIssue(parsed.owner, parsed.repo, parsed.issueNumber, config.githubToken);
  issueSpinner.succeed(`Fetched issue #${parsed.issueNumber}: "${issue.title}" (${issue.comments.length} comments)`);

  const dnaSpinner = ora("Extracting repo DNA — this may take a moment on large repos...").start();
  const dna = await extractDNA(repoPath);
  dnaSpinner.succeed(
    `DNA extracted: ${dna.files.length} files, ${dna.functions.length} functions, ${dna.helpers.length} shared helpers`
  );
  console.log(chalk.dim(`  Naming convention: ${dna.naming.dominantStyle}`));

  const mapping = mapIssueToDNA(issue, dna);

  // semantic search + planner agent: an LLM-judgment layer on top of keyword matching.
  // Degrades gracefully — if embeddings or the planner call fail, we fall back to
  // pure keyword matching, which still works on its own.
  let refinedFiles: string[] | undefined;
  if (!options.noSemantic) {
    const semanticSpinner = ora("Running semantic search over the codebase...").start();
    try {
      const index = await buildSemanticIndex(dna, provider);
      const query = `${issue.title}\n${issue.body}`.slice(0, 2000);
      const matches = await semanticSearch(index, query, provider, 12);
      semanticSpinner.succeed(`Semantic search found ${matches.length} candidate matches`);

      const planSpinner = ora("Running planner agent to select target files...").start();
      const agentPlan = await planTargets(issue, dna, mapping, matches, provider, config.model);
      if (agentPlan.usedFallback) {
        planSpinner.warn(`Planner agent fell back to keyword matching: ${agentPlan.reasoning}`);
      } else {
        planSpinner.succeed(`Planner agent selected ${agentPlan.targetFiles.length} target file(s)`);
        console.log(chalk.dim(`  Reasoning: ${agentPlan.reasoning}`));
        refinedFiles = agentPlan.targetFiles;
      }
    } catch (err) {
      semanticSpinner.warn(`Semantic search/planning unavailable, using keyword matching only: ${(err as Error).message}`);
    }
  }

  if ((refinedFiles ?? mapping.relevantFiles).length === 0) {
    console.warn(chalk.yellow("Warning: no files matched the issue. The LLM will work from repo structure alone — fix quality may be lower."));
  }

  const plan = createPlan(issue.title, mapping);
  const prompt = buildPrompt(issue, dna, mapping, plan, repoPath, refinedFiles);

  const originalBranch = getCurrentBranch();
  const fixBranch = `fix/issue-${parsed.issueNumber}`;

  const branchSpinner = ora(`Creating safety branch ${fixBranch}...`).start();
  if (branchExists(fixBranch)) {
    checkoutBranch(fixBranch);
  } else {
    createBranch(fixBranch);
  }
  branchSpinner.succeed(`On branch ${fixBranch}`);

  const healSpinner = ora("Generating fix and running self-healing loop...").start();
  const healResult = await runSelfHealLoop({
    repoRoot: repoPath,
    prompt,
    provider,
    model: config.model,
    testCommand: config.testCommand,
    maxAttempts: config.maxHealAttempts,
  });

  if (!healResult.success) {
    if (healResult.noParseableChange) {
      healSpinner.fail(
        `The model never produced a parseable SEARCH/REPLACE response across ${healResult.attempts} attempt(s). No changes were applied.`
      );
    } else {
      healSpinner.fail(`Fix did not pass tests after ${healResult.attempts} attempt(s).`);
      console.error(chalk.red(healResult.finalOutput));
    }
    checkoutBranch(originalBranch);
    process.exitCode = 1;
    return;
  }

  healSpinner.succeed(`Tests passed after ${healResult.attempts} attempt(s)`);
  console.log(chalk.dim(`  Files changed: ${healResult.filesChanged.join(", ")}`));

  commitChanges(`fix: resolve issue #${parsed.issueNumber} - ${issue.title}`);

  if (!config.githubToken) {
    console.log(chalk.green(`Done. Fix is committed locally on branch "${fixBranch}". Push manually to open a PR.`));
    return;
  }

  const prSpinner = ora("Opening pull request...").start();
  const baseBranch = await getDefaultBranch(parsed.owner, parsed.repo, config.githubToken);

  const prOutcome = await openPullRequest({
    owner: parsed.owner,
    repo: parsed.repo,
    branchName: fixBranch,
    baseBranch,
    title: `Fix: ${issue.title}`,
    body: `Resolves #${parsed.issueNumber}\n\nAutomated fix generated by resolv, matching this repo's existing style:\n- Naming: ${dna.naming.dominantStyle}\n- Took ${healResult.attempts} attempt(s) to pass tests.`,
    githubToken: config.githubToken,
  });

  if (prOutcome.status === "opened") {
    prSpinner.succeed(`Pull request opened: ${prOutcome.url}`);
  } else {
    prSpinner.warn(prOutcome.reason);
    console.log(chalk.green(`Your fix is safe locally on branch "${prOutcome.branchName}". Push it manually and open the PR yourself when ready.`));
  }
}

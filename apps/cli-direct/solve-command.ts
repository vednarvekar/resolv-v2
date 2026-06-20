// apps/cli-direct/solve-command.ts
// Full issue-fix pipeline: fetch issue → DNA → plan → edit → test → commit → PR.

import path from "node:path";
import chalk from "chalk";
import ora from "ora";

import { loadConfig, loadAppConfig } from "../../config/config.js";
import { createProviderFromEnv } from "../../packages/providers/register.js";
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

export interface SolveOptions {
  issueUrl: string;
  repoPath: string;
  noSemantic?: boolean;
}

export async function solve(options: SolveOptions): Promise<void> {
  const config = loadConfig();
  const appConfig = loadAppConfig();
  const provider = createProviderFromEnv(config);
  const repoPath = path.resolve(options.repoPath);

  await provider.healthCheck?.(appConfig.model);

  const guardSpinner = ora("Checking working directory...").start();
  try {
    assertCleanWorkingDirectory();
    guardSpinner.succeed("Working directory is clean");
  } catch (err) {
    guardSpinner.fail((err as Error).message);
    process.exitCode = 1;
    return;
  }

  const parsed = parseIssueUrl(options.issueUrl);

  const issueSpinner = ora(`Fetching issue #${parsed.issueNumber}...`).start();
  const issue = await fetchIssue(parsed.owner, parsed.repo, parsed.issueNumber, appConfig.githubToken);
  issueSpinner.succeed(`"${issue.title}" (${issue.comments.length} comments)`);

  const dnaSpinner = ora("Extracting repo DNA...").start();
  const dna = await extractDNA(repoPath);
  dnaSpinner.succeed(`${dna.files.length} files · ${dna.functions.length} functions · ${dna.helpers.length} helpers`);

  const mapping = mapIssueToDNA(issue, dna);

  let refinedFiles: string[] | undefined;
  if (!options.noSemantic) {
    const semSpinner = ora("Running semantic search...").start();
    try {
      const index = await buildSemanticIndex(dna, provider);
      const query = `${issue.title}\n${issue.body}`.slice(0, 2000);
      const matches = await semanticSearch(index, query, provider, 12);
      semSpinner.succeed(`${matches.length} semantic matches`);

      const planSpinner = ora("Planner agent selecting target files...").start();
      const agentPlan = await planTargets(issue, dna, mapping, matches, provider, appConfig.model);
      if (agentPlan.usedFallback) {
        planSpinner.warn(`Fell back to keyword matching: ${agentPlan.reasoning}`);
      } else {
        planSpinner.succeed(`${agentPlan.targetFiles.length} target file(s) selected`);
        refinedFiles = agentPlan.targetFiles;
      }
    } catch (err) {
      semSpinner.warn(`Semantic search unavailable, using keyword matching: ${(err as Error).message}`);
    }
  }

  const plan = createPlan(issue.title, mapping);
  const prompt = buildPrompt(issue, dna, mapping, plan, repoPath, refinedFiles);

  const originalBranch = getCurrentBranch();
  const fixBranch = `fix/issue-${parsed.issueNumber}`;

  const branchSpinner = ora(`Branch: ${fixBranch}`).start();
  if (branchExists(fixBranch)) {
    checkoutBranch(fixBranch);
  } else {
    createBranch(fixBranch);
  }
  branchSpinner.succeed(`On branch ${fixBranch}`);

  const healSpinner = ora("Generating fix...").start();
  const healResult = await runSelfHealLoop({
    repoRoot: repoPath,
    prompt,
    provider,
    model: appConfig.model,
    testCommand: appConfig.testCommand,
    maxAttempts: appConfig.maxHealAttempts,
  });

  if (!healResult.success) {
    if (healResult.noParseableChange) {
      healSpinner.fail(`Model produced no parseable SEARCH/REPLACE blocks after ${healResult.attempts} attempts.`);
    } else {
      healSpinner.fail(`Tests still failing after ${healResult.attempts} attempts.`);
      console.error(chalk.red(healResult.finalOutput));
    }
    checkoutBranch(originalBranch);
    process.exitCode = 1;
    return;
  }

  healSpinner.succeed(`Tests pass (${healResult.attempts} attempt${healResult.attempts > 1 ? "s" : ""})`);
  console.log(chalk.dim(`  Changed: ${healResult.filesChanged.join(", ")}`));

  commitChanges(`fix: resolve issue #${parsed.issueNumber} — ${issue.title}`);

  if (!appConfig.githubToken) {
    console.log(chalk.green(`\n  Done. Fix committed on "${fixBranch}". Push manually to open a PR.\n`));
    return;
  }

  const prSpinner = ora("Opening pull request...").start();
  const baseBranch = await getDefaultBranch(parsed.owner, parsed.repo, appConfig.githubToken);
  const prOutcome = await openPullRequest({
    owner: parsed.owner,
    repo: parsed.repo,
    branchName: fixBranch,
    baseBranch,
    title: `Fix: ${issue.title}`,
    body: `Resolves #${parsed.issueNumber}\n\nGenerated by resolv — ${healResult.attempts} attempt(s), matching existing style (${dna.dominantNaming}, ${dna.dominantAsyncStyle}).`,
    githubToken: appConfig.githubToken,
  });

  if (prOutcome.status === "opened") {
    prSpinner.succeed(`PR opened: ${prOutcome.url}`);
  } else {
    prSpinner.warn(prOutcome.reason);
    console.log(chalk.green(`  Fix is on branch "${fixBranch}". Push and open PR manually.\n`));
  }
}

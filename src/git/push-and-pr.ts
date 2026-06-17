import { execSync } from "node:child_process";
import { Octokit } from "@octokit/rest";

export interface OpenPullRequestOptions {
  owner: string;
  repo: string;
  branchName: string;
  baseBranch: string;
  title: string;
  body: string;
  githubToken: string;
}

export type PrOutcome =
  | { status: "opened"; url: string }
  | { status: "failed"; reason: string; branchName: string };

export function pushBranch(branchName: string): void {
  execSync(`git push -u origin ${branchName}`, { stdio: "inherit" });
}

/**
 * Pushes the fix branch to origin and opens a Pull Request against the base branch.
 * Never throws — push/PR failures (missing remote, no write access, rate limits,
 * GitHub outage, etc.) are reported back as a structured failure so the CLI can
 * tell the user their fix is still safe on a local branch.
 */
export async function openPullRequest(options: OpenPullRequestOptions): Promise<PrOutcome> {
  try {
    pushBranch(options.branchName);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      status: "failed",
      reason: `Failed to push branch to origin: ${reason}`,
      branchName: options.branchName,
    };
  }

  try {
    const octokit = new Octokit({ auth: options.githubToken });
    const { data: pr } = await octokit.rest.pulls.create({
      owner: options.owner,
      repo: options.repo,
      title: options.title,
      body: options.body,
      head: options.branchName,
      base: options.baseBranch,
    });
    return { status: "opened", url: pr.html_url };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      status: "failed",
      reason: `Branch was pushed, but opening the PR failed (likely missing write access or an invalid GITHUB_TOKEN): ${reason}`,
      branchName: options.branchName,
    };
  }
}

/** Detects the repo's default branch (main/master/etc.) via the GitHub API. */
export async function getDefaultBranch(
  owner: string,
  repo: string,
  githubToken: string
): Promise<string> {
  const octokit = new Octokit({ auth: githubToken });
  const { data } = await octokit.rest.repos.get({ owner, repo });
  return data.default_branch;
}

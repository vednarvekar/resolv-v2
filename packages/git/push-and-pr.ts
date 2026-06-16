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

export function pushBranch(branchName: string): void {
  execSync(`git push -u origin ${branchName}`, { stdio: "inherit" });
}

/**
 * Pushes the fix branch to origin and opens a Pull Request against the base branch.
 * Returns the PR URL so the CLI can print it for the user.
 */
export async function openPullRequest(options: OpenPullRequestOptions): Promise<string> {
  pushBranch(options.branchName);

  const octokit = new Octokit({ auth: options.githubToken });

  const { data: pr } = await octokit.rest.pulls.create({
    owner: options.owner,
    repo: options.repo,
    title: options.title,
    body: options.body,
    head: options.branchName,
    base: options.baseBranch,
  });

  return pr.html_url;
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
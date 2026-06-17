import { execSync } from "node:child_process";

export function createBranch(branchName: string): void {
  execSync(`git checkout -b ${branchName}`, { stdio: "inherit" });
}

/** True if the branch already exists locally. */
export function branchExists(branchName: string): boolean {
  try {
    execSync(`git rev-parse --verify ${branchName}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Throws if the working directory has uncommitted changes. Call this before
 * creating/checking out the fix branch so the agent never mixes its own
 * commits with the user's in-progress, uncommitted work.
 */
export function assertCleanWorkingDirectory(): void {
  const status = execSync("git status --porcelain", { encoding: "utf-8" }).trim();
  if (status.length > 0) {
    throw new Error(
      "Working directory has uncommitted changes. Commit or stash them before running resolv, " +
      "so your in-progress work doesn't get mixed into the automated fix branch."
    );
  }
}

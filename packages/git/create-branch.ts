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
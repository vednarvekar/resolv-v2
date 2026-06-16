import { execSync } from "node:child_process";

export function checkoutBranch(branchName: string): void {
  execSync(`git checkout ${branchName}`, { stdio: "inherit" });
}

export function getCurrentBranch(): string {
  return execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
}
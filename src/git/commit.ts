import { execSync } from "node:child_process";

export function commitChanges(message: string): void {
  execSync("git add .", { stdio: "inherit" });
  // escape double quotes in the commit message to avoid breaking the shell command
  const safeMessage = message.replace(/"/g, '\\"');
  execSync(`git commit -m "${safeMessage}"`, { stdio: "inherit" });
}

export function hasUncommittedChanges(): boolean {
  const status = execSync("git status --porcelain", { encoding: "utf-8" });
  return status.trim().length > 0;
}

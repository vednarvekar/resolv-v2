import { execSync } from "node:child_process";

export function createBranch(
  branchName: string
): void {

  execSync(
    `git checkout -b ${branchName}`,
    {
      stdio: "inherit"
    }
  );
}
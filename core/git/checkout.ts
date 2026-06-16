import { execSync } from "node:child_process";

export function checkoutBranch(
  branchName: string
): void {

  execSync(
    `git checkout ${branchName}`,
    {
      stdio: "inherit"
    }
  );
}
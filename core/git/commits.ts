import { execSync } from "node:child_process";

export function commitChanges(
  message: string
): void {

  execSync(
    "git add .",
    { stdio: "inherit" }
  );

  execSync(
    `git commit -m "${message}"`,
    { stdio: "inherit" }
  );
}
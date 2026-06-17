import chalk from "chalk";

export function runConfigCommand(): void {
  console.log(chalk.bold("resolv configuration check"));
  console.log(chalk.dim("─".repeat(50)));

  const nimKey = process.env.NVIDIA_API_KEY;
  printCheck("NVIDIA_API_KEY", !!nimKey, "Required. Get a free key at https://build.nvidia.com");

  const ghToken = process.env.GITHUB_TOKEN;
  printCheck(
    "GITHUB_TOKEN",
    !!ghToken,
    "Optional. Without it, fixes stay local (no PR is opened). Needs repo write access to open PRs."
  );

  const model = process.env.RESOLV_MODEL;
  console.log(`${chalk.cyan("RESOLV_MODEL:")}        ${model ?? chalk.dim("(default: meta/llama-3.3-70b-instruct)")}`);

  const testCmd = process.env.RESOLV_TEST_COMMAND;
  console.log(`${chalk.cyan("RESOLV_TEST_COMMAND:")} ${testCmd ?? chalk.dim("(default: npm test)")}`);

  const maxAttempts = process.env.RESOLV_MAX_ATTEMPTS;
  console.log(`${chalk.cyan("RESOLV_MAX_ATTEMPTS:")} ${maxAttempts ?? chalk.dim("(default: 4)")}`);

  console.log("");
  if (!nimKey) {
    console.log(chalk.red("Cannot run `resolv solve` without NVIDIA_API_KEY set."));
    process.exitCode = 1;
  } else {
    console.log(chalk.green("Ready to run `resolv solve <issue-url>`."));
  }
}

function printCheck(name: string, ok: boolean, hint: string): void {
  const status = ok ? chalk.green("✓ set") : chalk.red("✗ missing");
  console.log(`${chalk.cyan(`${name}:`)} ${status}`);
  if (!ok) console.log(chalk.dim(`  ${hint}`));
}

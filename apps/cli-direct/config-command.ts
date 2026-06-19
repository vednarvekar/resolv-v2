import chalk from "chalk";
import dotenv from "dotenv"
dotenv.config()

export function runConfigCommand(): void {
  console.log(chalk.bold("resolv configuration check"));
  console.log(chalk.dim("─".repeat(50)));

  const provider = process.env.RESOLV_PROVIDER ?? "nim";
  console.log(`${chalk.cyan("RESOLV_PROVIDER:")}     ${provider}`);

  const nimKey = process.env.NVIDIA_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const googleKey = process.env.GOOGLE_API_KEY;

  if (provider === "nim") {
    printCheck("NVIDIA_API_KEY", !!nimKey, "Required for RESOLV_PROVIDER=nim.");
  } else if (provider === "anthropic") {
    printCheck("ANTHROPIC_API_KEY", !!anthropicKey, "Required for RESOLV_PROVIDER=anthropic.");
  } else if (provider === "google") {
    printCheck("GOOGLE_API_KEY", !!googleKey, "Required for RESOLV_PROVIDER=google.");
  } else {
    printCheck("RESOLV_PROVIDER", false, 'Supported values: "nim", "anthropic", "google".');
  }

  const ghToken = process.env.GITHUB_TOKEN;
  printCheck(
    "GITHUB_TOKEN",
    !!ghToken,
    "Optional. Without it, fixes stay local (no PR is opened). Needs repo write access to open PRs."
  );

  const model = process.env.RESOLV_MODEL;
  console.log(`${chalk.cyan("RESOLV_MODEL:")}        ${model ?? chalk.dim("(provider default)")}`);

  const testCmd = process.env.RESOLV_TEST_COMMAND;
  console.log(`${chalk.cyan("RESOLV_TEST_COMMAND:")} ${testCmd ?? chalk.dim("(default: npm test)")}`);

  const maxAttempts = process.env.RESOLV_MAX_ATTEMPTS;
  console.log(`${chalk.cyan("RESOLV_MAX_ATTEMPTS:")} ${maxAttempts ?? chalk.dim("(default: 4)")}`);

  console.log("");
  const ready =
    (provider === "nim" && !!nimKey) ||
    (provider === "anthropic" && !!anthropicKey) ||
    (provider === "google" && !!googleKey);

  if (!ready) {
    console.log(chalk.red("Cannot run `solve` until the selected provider is configured."));
    process.exitCode = 1;
  } else {
    console.log(chalk.green("Ready to run `solve <issue-url>`."));
  }
}

function printCheck(name: string, ok: boolean, hint: string): void {
  const status = ok ? chalk.green("✓ set") : chalk.red("✗ missing");
  console.log(`${chalk.cyan(`${name}:`)} ${status}`);
  if (!ok) console.log(chalk.dim(`  ${hint}`));
}

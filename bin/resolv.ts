#!/usr/bin/env node
// bin/resolv.ts
// CLI entry point. Routes to:
// - setup wizard on first run (no config file exists)
// - subcommands: solve, dna, config, setup
// - interactive REPL when called with no arguments

import { Command } from "commander";
import { isFirstRun } from "../config/config.js";
import { runSetupWizard } from "../apps/tui/setup-wizard.js";
import { solve } from "../apps/cli-direct/solve-command.js";
import { runDnaCommand } from "../apps/cli-direct/dna-command.js";
import { runConfigCommand } from "../apps/cli-direct/config-command.js";
import { startRepl } from "../apps/cli-direct/repl.js";

const program = new Command();

program
  .name("resolv")
  .description("Style-matching GitHub issue resolver")
  .version("2.0.0");

program
  .command("setup")
  .description("Run the interactive setup wizard (provider, API key, model)")
  .action(async () => {
    await runSetupWizard();
  });

program
  .command("solve")
  .description("Fix a GitHub issue and open a PR")
  .argument("<issue-url>", "GitHub issue URL")
  .option("-p, --path <path>", "Local repo path", process.cwd())
  .option("--no-semantic", "Skip semantic search (faster, keyword-only)")
  .action(async (issueUrl: string, opts: { path: string; semantic: boolean }) => {
    try {
      await solve({ issueUrl, repoPath: opts.path, noSemantic: !opts.semantic });
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

program
  .command("dna")
  .description("Scan repo style DNA")
  .option("-p, --path <path>", "Repo path", process.cwd())
  .option("--json <outputPath>", "Write full JSON profile to file")
  .action(async (opts: { path: string; json?: string }) => {
    try {
      await runDnaCommand({ repoPath: opts.path, outputJson: opts.json });
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

program
  .command("config")
  .description("Show current configuration")
  .action(() => runConfigCommand());

// No subcommand → first run check → REPL
if (process.argv.length <= 2) {
  if (isFirstRun()) {
    runSetupWizard().then(() => {
      // After setup, offer to start the REPL
      import("../apps/cli-direct/repl.js").then(({ startRepl }) => startRepl());
    });
  } else {
    startRepl();
  }
} else {
  program.parse();
}
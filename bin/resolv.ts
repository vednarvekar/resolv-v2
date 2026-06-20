#!/usr/bin/env node
// bin/resolv.ts — CLI entry point

import dotenv from "dotenv";
import { Command } from "commander";
import { isConfigured, isFirstRun, loadConfig } from "../config/config.js";
import { runSetupWizard } from "../apps/tui/setup-wizard.js";
import { solve } from "../apps/cli-direct/solve-command.js";
import { runDnaCommand } from "../apps/cli-direct/dna-command.js";
import { runConfigCommand } from "../apps/cli-direct/config-command.js";
import { startRepl } from "../apps/cli-direct/repl.js";

dotenv.config({ quiet: true });

const program = new Command();

program
  .name("resolv")
  .description("Style-matching GitHub issue resolver")
  .version("2.0.0")
  .option("--resume <session-id>", "Resume a previous chat session");

program
  .command("setup")
  .description("Run the interactive setup wizard")
  .action(async () => { await runSetupWizard(); });

program
  .command("solve")
  .description("Fix a GitHub issue and open a PR")
  .argument("<issue-url>", "GitHub issue URL")
  .option("-p, --path <path>", "Local repo path", process.cwd())
  .option("--no-semantic", "Skip semantic search (faster)")
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
  .option("--json <outputPath>", "Write full JSON to file")
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

// No subcommand → REPL (or first-run wizard)
if (process.argv.length <= 2 || process.argv[2]?.startsWith("--resume")) {
  const opts = program.opts<{ resume?: string }>();
  // parse just the root options (not subcommands)
  program.parseOptions(process.argv.slice(2));
  const resumeId = program.opts<{ resume?: string }>().resume;

  const config = loadConfig();
  if (isFirstRun() || !isConfigured(config) || !config.model) {
    runSetupWizard().then(() => startRepl());
  } else {
    startRepl(resumeId);
  }
} else {
  program.parse();
}
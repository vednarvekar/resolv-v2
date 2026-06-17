import { Command } from "commander";
import { solve } from "../packages/cli/solve-command.js";
import { runDnaCommand } from "../packages/cli/dna-command.js";
import { runConfigCommand } from "../packages/cli/config-command.js";
import { startRepl } from "../packages/cli/repl.js";

const program = new Command();

program
  .name("resolv")
  .description("In-Context, Style-Matching Issue Resolver CLI")
  .version("1.0.0");

program
  .command("solve")
  .description("Solve a GitHub issue by generating a style-matched fix and opening a PR")
  .argument("<issue-url>", "GitHub issue URL, e.g. https://github.com/owner/repo/issues/123")
  .option("-p, --path <path>", "Path to the local repo", process.cwd())
  .option("--no-semantic", "Skip semantic search + planner agent, use keyword matching only (faster, cheaper)")
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
  .description("Analyze a repo's style DNA without solving an issue — useful for demos and quick inspection")
  .option("-p, --path <path>", "Path to the local repo", process.cwd())
  .option("--json <outputPath>", "Write the full DNA profile as JSON to this path instead of printing a summary")
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
  .description("Check whether required environment variables are set")
  .action(() => {
    runConfigCommand();
  });

// Typing just `resolv` with no subcommand drops into an interactive shell
// (codex / claude-code style) instead of printing commander's default help.
if (process.argv.length <= 2) {
  startRepl();
} else {
  program.parse();
}
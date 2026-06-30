// apps/cli-direct/dna-command.ts
// Runs DNA extraction and either prints a summary or writes JSON.
// The JSON output is intentionally compact — see packages/dna/types.ts.

import path from "node:path";
import fs from "node:fs";
import chalk from "chalk";
import ora from "ora";
import { extractDNA } from "../../packages/dna/extract.js";

export interface DnaCommandOptions {
  repoPath: string;
  outputJson?: string;
}

export async function runDnaCommand(options: DnaCommandOptions): Promise<void> {
  const repoPath = path.resolve(options.repoPath);

  const spinner = ora(`Scanning ${repoPath}...`).start();
  const dna = await extractDNA(repoPath);
  spinner.succeed(`Scanned ${dna.files.length} files`);

  if (options.outputJson) {
    fs.writeFileSync(options.outputJson, JSON.stringify(dna, null, 2), "utf-8");
    const bytes = fs.statSync(options.outputJson).size;
    console.log(chalk.green(`  DNA profile written to ${options.outputJson}`));
    console.log(chalk.dim(`  Size: ${(bytes / 1024).toFixed(1)} KB`));
    return;
  }

  // Summary print
  console.log("");
  console.log(chalk.hex("#7c3aed").bold("  Repository DNA"));
  console.log(chalk.dim("  " + "─".repeat(48)));
  console.log(`  ${chalk.cyan("Files:")}         ${dna.files.length}`);
  console.log(`  ${chalk.cyan("Functions:")}     ${dna.functions.length} (avg ${dna.functionStats.avgFunctionSize} lines, ${dna.functionStats.asyncPercentage}% async)`);
  console.log(`  ${chalk.cyan("Helpers:")}       ${dna.helpers.length} cross-file utilities`);
  console.log(`  ${chalk.cyan("Dependencies:")}  ${dna.dependencies.length}`);
  console.log("");
  console.log(`  ${chalk.cyan("Naming:")}        ${dna.dominantNaming} ${chalk.dim(`(${Math.round(dna.namingConfidence * 100)}%)`)}`);
  console.log(`  ${chalk.cyan("Async style:")}   ${dna.dominantAsyncStyle} ${chalk.dim(`(${Math.round(dna.asyncConfidence * 100)}%)`)}`);
  console.log(`  ${chalk.cyan("Error style:")}   ${dna.dominantErrorStyle} ${chalk.dim(`(${Math.round(dna.errorConfidence * 100)}%)`)}`);
  console.log("");

  if (dna.helpers.length > 0) {
    console.log(chalk.dim("  Top helpers:"));
    for (const h of dna.helpers.slice(0, 5)) {
      console.log(`    ${chalk.yellow(h.name)} — ${h.usages}x in ${h.files.length} files`);
    }
    console.log("");
  }

  const arch = dna.architecture;
  const layers = [
    arch.routes.length > 0 && `routes: ${arch.routes.length}`,
    arch.controllers.length > 0 && `controllers: ${arch.controllers.length}`,
    arch.services.length > 0 && `services: ${arch.services.length}`,
    arch.repositories.length > 0 && `repositories: ${arch.repositories.length}`,
  ].filter(Boolean);
  if (layers.length > 0) {
    console.log(`  ${chalk.cyan("Architecture:")} ${layers.join("  ")}`);
    console.log("");
  }

  console.log(chalk.dim("  Tip: run with --json <path> to export the full profile."));
  console.log("");
}
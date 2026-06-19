import path from "node:path";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs";

import { extractDNA } from "../../packages/dna/extract.js";

export interface DnaCommandOptions {
  repoPath: string;
  /** write the full DNA profile as JSON to this path instead of printing a summary */
  outputJson?: string;
}

export async function runDnaCommand(options: DnaCommandOptions): Promise<void> {
  const repoPath = path.resolve(options.repoPath);

  const spinner = ora(`Scanning ${repoPath}...`).start();
  const dna = await extractDNA(repoPath);
  spinner.succeed(`Scanned ${dna.files.length} files`);

  if (options.outputJson) {
    fs.writeFileSync(options.outputJson, JSON.stringify(dna, null, 2), "utf-8");
    console.log(chalk.green(`Full DNA profile written to ${options.outputJson}`));
    return;
  }

  console.log("");
  console.log(chalk.bold("Repository DNA Summary"));
  console.log(chalk.dim("─".repeat(50)));

  console.log(`${chalk.cyan("Files:")}        ${dna.files.length}`);
  console.log(`${chalk.cyan("Functions:")}    ${dna.functions.length} (avg ${dna.functionStats.avgFunctionSize} lines, ${dna.functionStats.asyncPercentage}% async)`);
  console.log(`${chalk.cyan("Helpers:")}      ${dna.helpers.length} shared utilities detected`);
  console.log(`${chalk.cyan("Dependencies:")} ${dna.dependencies.length} declared`);

  console.log("");
  console.log(chalk.bold("Style Profile"));
  console.log(chalk.dim("─".repeat(50)));
  console.log(`${chalk.cyan("Naming:")}        ${dna.naming.dominantStyle} (camel:${dna.naming.camelCase} snake:${dna.naming.snake_case} pascal:${dna.naming.PascalCase} screaming:${dna.naming.SCREAMING_SNAKE})`);

  const errorStyles = countBy(dna.errorPatterns.map((e) => e.style));
  console.log(`${chalk.cyan("Error handling:")} ${formatCounts(errorStyles)}`);

  const asyncStyles = countBy(dna.asyncPatterns.map((p) => p.dominantStyle));
  console.log(`${chalk.cyan("Async style:")}    ${formatCounts(asyncStyles)}`);

  console.log("");
  console.log(chalk.bold("Top 10 Most-Reused Helpers"));
  console.log(chalk.dim("─".repeat(50)));
  for (const helper of dna.helpers.slice(0, 10)) {
    console.log(`  ${chalk.yellow(helper.name)} — used ${helper.usages}x across ${helper.files.length} file(s)`);
  }

  console.log("");
  console.log(chalk.bold("Architecture Layers Detected"));
  console.log(chalk.dim("─".repeat(50)));
  console.log(`  Routes: ${dna.architecture.routes.length}  Controllers: ${dna.architecture.controllers.length}  Services: ${dna.architecture.services.length}  Repositories: ${dna.architecture.repositories.length}`);

  const unused = dna.dependencies.filter((d) => d.usageCount === 0);
  if (unused.length > 0) {
    console.log("");
    console.log(chalk.bold("Unused Dependencies (declared but never imported)"));
    console.log(chalk.dim("─".repeat(50)));
    for (const dep of unused) console.log(`  ${chalk.gray(dep.name)}@${dep.version}`);
  }

  console.log("");
  console.log(chalk.dim(`Tip: run with --json <path> to export the full DNA profile.`));
}

function countBy<T extends string>(values: T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return counts;
}

function formatCounts<T extends string>(counts: Map<T, number>): string {
  if (counts.size === 0) return "(none detected)";
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join(", ");
}

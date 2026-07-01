import type { ToolDefinition } from "../../core/types.js";
import { extractDNA } from "../../dna/extract.js";
import { runTests } from "../../coding-agent/run-tests.js";

export function createRepoTools(repoRoot: string): ToolDefinition[] {
  return [
    {
      name: "scan_repo_dna",
      description: "Analyze the repo's code style, architecture, functions, and helpers. Returns a compact summary.",
      inputSchema: { type: "object", properties: {}, required: [] },
      async execute() {
        const dna = await extractDNA(repoRoot);
        const topHelpers = dna.helpers.slice(0, 8).map((h) => `${h.name} (${h.usages}x)`).join(", ");
        const pct = (c: number) => `${Math.round(c * 100)}%`;
        const output = [
          `Files: ${dna.files.length}`,
          `Functions: ${dna.functions.length} (avg ${dna.functionStats.avgFunctionSize} lines, ${dna.functionStats.asyncPercentage}% async)`,
          `Helpers: ${dna.helpers.length} cross-file utilities`,
          `Naming: ${dna.dominantNaming} (${pct(dna.namingConfidence)} of names — ${dna.namingConfidence < 0.7 ? "not a strict convention, mixed styles exist" : "consistent convention"})`,
          `Async style: ${dna.dominantAsyncStyle} (${pct(dna.asyncConfidence)} of files)`,
          `Error style: ${dna.dominantErrorStyle} (${pct(dna.errorConfidence)} of files)`,
          `Top helpers: ${topHelpers || "(none)"}`,
          `Architecture: routes=${dna.architecture.routes.length} services=${dna.architecture.services.length} repos=${dna.architecture.repositories.length}`,
        ].join("\n");
        return { output, isError: false };
      },
    },
    {
      name: "run_tests",
      description: "Run the test suite. Returns PASS/FAIL and test output.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "Test command (default: npm test)" },
        },
      },
      async execute(input) {
        const command = String(input.command ?? "npm test");
        const result = runTests(repoRoot, command);
        return { output: `${result.passed ? "PASS" : "FAIL"}\n${result.output}`, isError: !result.passed };
      },
    },
  ];
}

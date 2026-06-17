import type { IssueMapping } from "../issue/issue-mapper.js";

export interface FixStep {
  order: number;
  action: string;
}

export interface FixPlan {
  summary: string;
  targetFiles: string[];
  targetFunctions: string[];
  targetHelpers: string[];
  steps: FixStep[];
}

export function createPlan(issueTitle: string, mapping: IssueMapping): FixPlan {
  const steps: FixStep[] = [];
  let order = 1;

  steps.push({ order: order++, action: "Inspect relevant files" });

  if (mapping.relevantFunctions.length) {
    steps.push({ order: order++, action: `Review functions: ${mapping.relevantFunctions.join(", ")}` });
  }

  if (mapping.relevantHelpers.length) {
    steps.push({ order: order++, action: `Reuse helpers: ${mapping.relevantHelpers.join(", ")}` });
  }

  steps.push({ order: order++, action: "Implement fix matching repo style" });
  steps.push({ order: order++, action: "Run test command and self-heal on failure" });

  return {
    summary: issueTitle,
    targetFiles: mapping.relevantFiles,
    targetFunctions: mapping.relevantFunctions,
    targetHelpers: mapping.relevantHelpers,
    steps,
  };
}

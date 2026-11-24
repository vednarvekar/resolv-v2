#!/usr/bin/env node
// Eval harness for resolv.
//
// Runs the *real* agent loop (packages/orchestrator-agent) against
// fixture repos on disk, using whatever provider the person has
// configured (defaults to nim, since it has a usable free tier — set
// RESOLV_EVAL_PROVIDER to override). Scoring is deterministic: each case
// inspects actual on-disk repo state after the run, not the model's
// self-reported text, so a model can't talk its way to a pass.
//
// Usage:
//   npx tsx evals/run-evals.ts
//   RESOLV_EVAL_PROVIDER=google npx tsx evals/run-evals.ts
//   npx tsx evals/run-evals.ts --only=trivial-bug-fix

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

import { loadConfig } from "../config/config.js";
import { createProviderFromConfig } from "../packages/providers/register.js";
import { AgentSession } from "../packages/orchestrator-agent/session.js";
import { ToolRegistry } from "../packages/orchestrator-agent/tool-registry.js";
import { AgentEventBus } from "../packages/core/events.js";
import { runAgentTurn } from "../packages/orchestrator-agent/agent-loop.js";
import { createLLMTools } from "../packages/llm/tools/llm-tools.js";

import type { EvalCase, EvalResult } from "./types.js";
import { trivialBugFix } from "./cases/01-trivial-bug-fix.js";
import { promptInjectionProtectedWrite } from "./cases/02-prompt-injection-protected-write.js";
import { noArbitraryShellExec } from "./cases/03-no-arbitrary-shell-exec.js";

const ALL_CASES: EvalCase[] = [trivialBugFix, promptInjectionProtectedWrite, noArbitraryShellExec];

function makeFixtureRepo(fixture: EvalCase["fixture"]): string {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "resolv-eval-"));
  for (const [relPath, content] of Object.entries(fixture.files)) {
    const abs = path.join(repoRoot, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf-8");
  }
  execSync("git init -q && git add -A && git -c user.email=eval@resolv -c user.name=eval commit -q -m init", {
    cwd: repoRoot,
  });
  for (const cmd of fixture.setupCommands ?? []) {
    execSync(cmd, { cwd: repoRoot, stdio: "pipe" });
  }
  return repoRoot;
}

async function runCase(evalCase: EvalCase): Promise<EvalResult> {
  const start = Date.now();
  const repoRoot = makeFixtureRepo(evalCase.fixture);
  const toolCallLog: { name: string; input: Record<string, unknown> }[] = [];

  try {
    const config = loadConfig();
    const provider = createProviderFromConfig(config);

    const tools = new ToolRegistry();
    tools.registerAll(createLLMTools(repoRoot, evalCase.testCommand));

    const events = new AgentEventBus();
    events.on((e) => {
      if (e.type === "tool_call_start") {
        toolCallLog.push({ name: e.toolName, input: e.input });
      }
    });

    const session = new AgentSession();
    session.setRepoPath(repoRoot);

    const result = await runAgentTurn(evalCase.task, {
      provider,
      model: config.model,
      tools,
      session,
      events,
      maxToolCallRounds: evalCase.maxToolCallRounds,
    });

    const failures = await evalCase.assert({
      repoRoot,
      responseText: result.responseText,
      toolCallRounds: result.toolCallRounds,
      toolCallLog,
      hitRoundLimit: result.hitRoundLimit,
      errored: false,
    });

    return {
      id: evalCase.id,
      category: evalCase.category,
      passed: failures.length === 0,
      failures,
      durationMs: Date.now() - start,
      toolCallRounds: result.toolCallRounds,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A thrown error (e.g. AgentLoopLimitError) still gets scored against
    // the case's assertions where possible — on-disk state is real even
    // if the agent didn't finish cleanly.
    let failures: string[];
    try {
      failures = await evalCase.assert({
        repoRoot,
        responseText: "",
        toolCallRounds: 0,
        toolCallLog,
        hitRoundLimit: true,
        errored: true,
      });
    } catch {
      failures = [`case threw before assertions could run: ${message}`];
    }
    return {
      id: evalCase.id,
      category: evalCase.category,
      passed: false,
      failures: failures.length ? failures : [`agent turn threw: ${message}`],
      durationMs: Date.now() - start,
      toolCallRounds: 0,
      error: message,
    };
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

async function main() {
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg?.split("=")[1];
  const cases = only ? ALL_CASES.filter((c) => c.id.includes(only)) : ALL_CASES;

  if (process.env.RESOLV_EVAL_PROVIDER) {
    process.env.RESOLV_PROVIDER = process.env.RESOLV_EVAL_PROVIDER;
  }

  const config = loadConfig();
  console.log(`\nRunning ${cases.length} eval case(s) against provider: ${config.provider} (${config.model ?? "default model"})\n`);

  const results: EvalResult[] = [];
  for (const c of cases) {
    process.stdout.write(`  ${c.id} ... `);
    const result = await runCase(c);
    results.push(result);
    console.log(result.passed ? "PASS" : "FAIL");
    if (!result.passed) {
      for (const f of result.failures) console.log(`      - ${f}`);
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const guardrailResults = results.filter((r) => r.category === "guardrail");
  const guardrailPassed = guardrailResults.filter((r) => r.passed).length;

  console.log(`\n${passed}/${results.length} passed`);
  console.log(`  guardrail cases: ${guardrailPassed}/${guardrailResults.length}`);

  const reportPath = path.join(process.cwd(), "evals", "last-run.json");
  fs.writeFileSync(reportPath, JSON.stringify({ provider: config.provider, model: config.model, results }, null, 2));
  console.log(`\nFull report: ${reportPath}\n`);

  if (passed !== results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

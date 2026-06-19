import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import chalk from "chalk";
import fs from "node:fs";
import path from "node:path";

// ── Local Escape Utilities ───────────────────────────────────
import { runConfigCommand } from "./config-command.js";
import { runDnaCommand } from "./dna-command.js";

// ── Orchestrator Core Layers ─────────────────────────────────
import { createProviderFromEnv } from "../../packages/providers/register.js";
import { AgentSession } from "../../packages/orchestrator-agent/session.js";
import { runAgentTurn } from "../../packages/orchestrator-agent/agent-loop.js";
import { ToolRegistry } from "../../packages/orchestrator-agent/tool-registry.js"; // Ensure path matches
import { AgentEventBus } from "../../packages/core/events.js";

export async function startRepl(): Promise<void> {
  const name = chalk.hex("#470a73").bold("resolv> ");
  const showWelcome = () => {
    console.log(chalk.blueBright.bgGray("     Welcome Ved!!.     "));
    console.log();
  };
  showWelcome();

  // 1. Initialize persistent architectural singletons
  const provider = createProviderFromEnv();
  const session = new AgentSession();
  
  // Initialize context parameters for the system prompt building logic
  session.setRepoPath(process.cwd());
  
  // instantiate your custom tool registry block mapping context
  const tools = new ToolRegistry(); 
  // Note: if you have tools, register them here (e.g., tools.register(someTool))

  // 2. Setup the event bus to react to streaming text and background processes
  const events = new AgentEventBus();

  events.on((event) => {
    switch (event.type) {
      case "text_delta":
        // Print streamed text blocks out in real-time
        process.stdout.write(event.text);
        break;

      case "tool_call_start":
        console.log(chalk.cyan(`\n🛠️  [Tool Call]: Running "${event.toolName}"...`));
        break;

      case "tool_call_end":
        if (event.isError) {
          console.log(chalk.red(`❌ [Tool Error]: Failed implementation call.`));
        } else {
          console.log(chalk.dim(`✅ [Tool Completed]`));
        }
        break;

      case "error":
        console.log(chalk.red(`\n⚠️  [Agent Error]: ${event.message}`));
        break;
    }
  });

  const rl = readline.createInterface({ input, output, prompt: `${name}` });
  
  rl.on("close", () => {
    console.log(chalk.yellow("\nGoodbye!"));
    process.exit(0);
  });

  rl.prompt();

  for await (const rawLine of rl) {
    const line = rawLine.trim();

    if (line === "") {
      rl.prompt();
      continue;
    }

    if (line === "clear" || line === "/clear") {
      // Explaining the ANSI trick: \u001b[2J clears the screen, \u001b[H homes the cursor at 0,0
      process.stdout.write("\u001b[2J\u001b[H"); 
      showWelcome();
      rl.prompt();
      continue;
    }

    // Standard local session escape conditions
    if (line === "exit" || line === "quit" || line === "/exit") {
      rl.close();
      return;
    }

    if (line === "/config") {
      runConfigCommand();
      rl.prompt();
      continue;
    } 

    if (line === "/dna") {
      const targetDir = path.join(process.cwd(), ".resolv");
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const outputFilePath = path.join(targetDir, "analysis.json");
      console.log(chalk.cyan("Running local DNA scan pipeline..."));
      
      await runDnaCommand({ 
        repoPath: process.cwd(), 
        outputJson: outputFilePath 
      });

      rl.prompt();
      continue;
    }

    if (line === "/help") {
      console.log("Commands: /config, /dna, /help, exit");
      rl.prompt();
      continue;
    }

    // 3. Fallback Route: Pass off conversational control loop directly to the runtime loop orchestrator
    try {
      await runAgentTurn(line, {
        provider,
        tools,
        session,
        events
      });
      
      console.log("\n");

    } catch (error) {
      console.log(
        chalk.red(`\nExecution Halted: ${error instanceof Error ? error.message : String(error)}`)
      );
    }

    rl.prompt();
  }
}
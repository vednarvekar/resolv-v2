import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import chalk from "chalk";

import { runConfigCommand } from "./config-command.js";

export async function startRepl(): Promise<void> {
  console.log(chalk.bold("resolv"));
  console.log(chalk.dim("Type `config`, `help`, or `exit`. Use `resolv solve <issue-url>` to run the solver."));

  const rl = readline.createInterface({ input, output, prompt: "resolv> " });
  rl.prompt();

  for await (const rawLine of rl) {
    const line = rawLine.trim();

    if (line === "exit" || line === "quit") {
      rl.close();
      return;
    }

    if (line === "config") {
      runConfigCommand();
    } else if (line === "help" || line === "") {
      console.log("Commands: config, help, exit");
    } else {
      console.log(chalk.yellow(`Unknown command: ${line}`));
    }

    rl.prompt();
  }
}

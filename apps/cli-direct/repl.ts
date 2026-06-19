import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import chalk from "chalk";
import fs from "node:fs";
import path from "node:path";

import { runConfigCommand } from "./config-command.js";
import { runDnaCommand } from "./dna-command.js";

export async function startRepl(): Promise<void> {
  const name = chalk.hex("#470a73").bold("resolv> ")
  // console.log(chalk.bold("resolv"));
  console.log(chalk.blueBright.bgGray("     Welcome Ved!!.    "));
  console.log()

  const rl = readline.createInterface({ input, output, prompt: `${name}` });
  
  // Handle the close event (triggered by rl.close() OR Ctrl+C)
  rl.on("close", () => {
    console.log(chalk.yellow("\nGoodbye!"));
    process.exit(0);
  });

  rl.prompt();

  for await (const rawLine of rl) {
    const line = rawLine.trim();

    if (line === "exit" || line === "quit") {
      rl.close(); // This will trigger the 'close' listener above
      return;
    }

    if (line === "/config") {
      runConfigCommand();
    } 
    else if (line === "/dna") {
      const targetDir = path.join(process.cwd(), ".resolv");
      
      // 1. Automatically ensure the hidden .resolv directory exists
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const outputFilePath = path.join(targetDir, "analysis.json");

      // 2. Trigger the scanner and auto-save the profile payload 
      await runDnaCommand({ 
        repoPath: process.cwd(), 
        outputJson: outputFilePath 
      });
    }
    else if (line === "/help" || line === "") {
      console.log("Commands: config, help, exit");
    } else {
      console.log(chalk.yellow(`Unknown command: ${line}`));
    }

    rl.prompt();
  }
}
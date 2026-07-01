import chalk from "chalk";

export function printBanner(): void {
  console.log("");
  console.log(chalk.hex("#7c3aed").bold(" ██████╗ ███████╗███████╗ ██████╗ ██╗    ██╗   ██╗    ██╗ "));
  console.log(chalk.hex("#7c3aed").bold(" ██╔══██╗██╔════╝██╔════╝██╔═══██╗██║    ██║   ██║    ██║ "));
  console.log(chalk.hex("#a78bfa").bold(" ██████╔╝█████╗  ███████╗██║   ██║██║    ██║   ██║    ██║ "));
  console.log(chalk.hex("#a78bfa").bold(" ██╔══██╗██╔══╝  ╚════██║██║   ██║██║    ╚██╗ ██╔╝    ╚═╝ "));
  console.log(chalk.hex("#c4b5fd").bold(" ██║  ██║███████╗███████║╚██████╔╝███████╗╚████╔╝     ██╗ "));
  console.log(chalk.hex("#c4b5fd").bold(" ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚══════╝ ╚═══╝      ╚═╝ "));
  console.log("");
  console.log(chalk.dim("  Style-matching GitHub issue resolver"));
  console.log("");
}

export function printOllamaInstructions(): void {
  console.log("");
  console.log(chalk.hex("#7c3aed").bold("  Ollama — local LLM setup"));
  console.log(chalk.dim("  " + "─".repeat(48)));
  console.log(`\n  ${chalk.bold("1.")} Install: ${chalk.cyan("curl -fsSL https://ollama.com/install.sh | sh")}`);
  console.log(`     Or download from ${chalk.underline("https://ollama.com/download")}`);
  console.log(`\n  ${chalk.bold("2.")} Pull a model:`);
  console.log(`     ${chalk.cyan("ollama pull qwen3.5:4b")}      ${chalk.dim("# 2.5GB, fast, good for code")}`);
  console.log(`     ${chalk.cyan("ollama pull deepseek-r1:8b")} ${chalk.dim("# 5GB, best reasoning")}`);
  console.log(`     ${chalk.cyan("ollama pull codellama:13b")}   ${chalk.dim("# 8GB, code-specialized")}`);
  console.log(`\n  ${chalk.bold("3.")} Start Ollama: ${chalk.cyan("ollama serve")}`);
  console.log(`\n  ${chalk.bold("WSL users:")} see README for mirrored networking setup.`);
  console.log(`\n  resolv connects to ${chalk.cyan("http://127.0.0.1:11434")} by default.`);
  console.log(`  Override: ${chalk.dim("OLLAMA_BASE_URL=http://yourhost:11434")}\n`);
}

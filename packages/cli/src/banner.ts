import chalk from "chalk";

export function printBanner(): void {
  console.log();
  console.log(chalk.bold.cyan("  🦞 CLAWRUN"));
  console.log(chalk.dim("  Deploy and manage AI agents in seconds.\n"));
}

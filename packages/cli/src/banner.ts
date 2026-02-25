import chalk from "chalk";

export function printBanner(): void {
  console.log();
  console.log(chalk.bold.cyan("  🦞 CLAWRUN"));
  console.log(chalk.dim("  AI agent hosting, simplified.\n"));
}

import chalk from "chalk";

export function printBanner(): void {
  console.log();
  console.log(chalk.bold.cyan("  🦞 CLOUDCLAW"));
  console.log(chalk.dim("  AI agent hosting, simplified.\n"));
}

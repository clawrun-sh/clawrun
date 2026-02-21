import chalk from "chalk";

export class StyledError extends Error {
  name = "StyledError";

  constructor(message: string) {
    super(chalk.red(message));
  }
}

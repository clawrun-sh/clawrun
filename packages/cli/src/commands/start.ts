import { command } from "cmd-ts";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { instance } from "../args/instance.js";
import { connectInstance } from "../connect-instance.js";

export const start = command({
  name: "start",
  description: "Start the instance's sandbox if it is not already running",
  args: {
    instance,
  },
  async handler({ instance: instanceName }) {
    const conn = connectInstance(instanceName);
    if (!conn) {
      clack.log.error(
        `Instance "${instanceName}" is not fully deployed. Run "clawrun deploy ${instanceName}" first.`,
      );
      process.exit(1);
    }

    const spinner = clack.spinner();
    spinner.start("Starting sandbox...");

    try {
      const result = await conn.instance.start();

      if (result.status === "running") {
        spinner.stop(chalk.green(`Sandbox running (${result.sandboxId ?? "ok"}).`));
      } else if (result.status === "failed") {
        spinner.stop(chalk.red(`Start failed: ${result.error}`));
        process.exit(1);
      }
    } catch (err) {
      spinner.stop(
        chalk.red(`Failed to start sandbox: ${err instanceof Error ? err.message : String(err)}`),
      );
      process.exit(1);
    }
  },
});

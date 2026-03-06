import { command } from "cmd-ts";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { instance } from "../args/instance.js";
import { yes } from "../args/yes.js";
import { connectInstance } from "../connect-instance.js";

export const stop = command({
  name: "stop",
  description: "Stop the instance's sandbox (snapshot + stop)",
  args: {
    instance,
    yes,
  },
  async handler({ instance: instanceName, yes: skipConfirm }) {
    const conn = connectInstance(instanceName);
    if (!conn) {
      clack.log.error(
        `Instance "${instanceName}" is not fully deployed. Run "clawrun deploy ${instanceName}" first.`,
      );
      process.exit(1);
    }

    if (!skipConfirm) {
      const confirm = await clack.confirm({
        message: `Stop sandbox for "${instanceName}"? A snapshot will be taken before stopping.`,
        initialValue: false,
      });

      if (clack.isCancel(confirm) || !confirm) {
        clack.cancel("Cancelled.");
        return;
      }
    }

    const spinner = clack.spinner();
    spinner.start("Stopping sandbox...");

    try {
      const result = await conn.instance.stop();

      if (result.status === "stopped" && result.sandboxId) {
        spinner.stop(chalk.green(`Sandbox stopped (${result.sandboxId}). Snapshot saved.`));
      } else if (result.status === "stopped") {
        spinner.stop(chalk.dim("No running sandbox to stop."));
      } else if (result.status === "failed") {
        spinner.stop(chalk.red(`Stop failed: ${result.error}`));
        process.exit(1);
      }
    } catch (err) {
      spinner.stop(
        chalk.red(`Failed to stop sandbox: ${err instanceof Error ? err.message : String(err)}`),
      );
      process.exit(1);
    }
  },
});

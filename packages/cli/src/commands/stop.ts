import { command } from "cmd-ts";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { readConfig } from "../instance/index.js";
import { instance } from "../args/instance.js";
import { yes } from "../args/yes.js";

export const stop = command({
  name: "stop",
  description: "Stop the instance's sandbox (snapshot + stop)",
  args: {
    instance,
    yes,
  },
  async handler({ instance: instanceName, yes: skipConfirm }) {
    const config = readConfig(instanceName);
    if (!config) {
      console.error(chalk.red(`Could not read config for "${instanceName}".`));
      process.exit(1);
    }

    const { deployedUrl } = config.instance;
    const { cronSecret } = config.secrets;
    if (!deployedUrl || !cronSecret) {
      console.error(chalk.red(`Instance "${instanceName}" is not fully deployed. Run "cloudclaw deploy ${instanceName}" first.`));
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
      const res = await fetch(`${deployedUrl}/api/v1/sandbox/stop`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cronSecret}` },
      });

      const body = await res.text();

      if (!res.ok) {
        spinner.stop(chalk.red(`Stop failed (HTTP ${res.status}): ${body}`));
        process.exit(1);
      }

      const result = JSON.parse(body) as Record<string, unknown>;

      if (result.status === "stopped" && result.sandboxId) {
        spinner.stop(chalk.green(`Sandbox stopped (${result.sandboxId}). Snapshot saved.`));
      } else if (result.status === "stopped") {
        spinner.stop(chalk.dim("No running sandbox to stop."));
      } else if (result.status === "failed") {
        spinner.stop(chalk.red(`Stop failed: ${result.error}`));
        process.exit(1);
      } else {
        spinner.stop(chalk.yellow(`Unexpected result: ${JSON.stringify(result)}`));
      }
    } catch (err) {
      spinner.stop(chalk.red(`Failed to stop sandbox: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  },
});

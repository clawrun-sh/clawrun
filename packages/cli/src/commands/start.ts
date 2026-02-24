import { command } from "cmd-ts";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { readConfig } from "../instance/index.js";
import { instance } from "../args/instance.js";
import { createApiClient } from "../api.js";

export const start = command({
  name: "start",
  description: "Start the instance's sandbox if it is not already running",
  args: {
    instance,
  },
  async handler({ instance: instanceName }) {
    const config = readConfig(instanceName);
    if (!config) {
      console.error(chalk.red(`Could not read config for "${instanceName}".`));
      process.exit(1);
    }

    const { deployedUrl } = config.instance;
    const { cronSecret } = config.secrets;
    if (!deployedUrl || !cronSecret) {
      console.error(
        chalk.red(
          `Instance "${instanceName}" is not fully deployed. Run "cloudclaw deploy ${instanceName}" first.`,
        ),
      );
      process.exit(1);
    }

    const spinner = clack.spinner();
    spinner.start("Starting sandbox...");

    try {
      const api = createApiClient(deployedUrl, cronSecret);
      const res = await api.post("/api/v1/sandbox/start");

      const body = await res.text();

      if (!res.ok) {
        spinner.stop(chalk.red(`Start failed (HTTP ${res.status}): ${body}`));
        process.exit(1);
      }

      const result = JSON.parse(body) as Record<string, unknown>;

      if (result.status === "running") {
        spinner.stop(chalk.green(`Sandbox running (${result.sandboxId ?? "ok"}).`));
      } else if (result.status === "failed") {
        spinner.stop(chalk.red(`Start failed: ${result.error}`));
        process.exit(1);
      } else {
        spinner.stop(chalk.yellow(`Unexpected result: ${JSON.stringify(result)}`));
      }
    } catch (err) {
      spinner.stop(
        chalk.red(`Failed to start sandbox: ${err instanceof Error ? err.message : String(err)}`),
      );
      process.exit(1);
    }
  },
});

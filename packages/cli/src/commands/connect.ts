import { command, positional, string } from "cmd-ts";
import chalk from "chalk";
import { createSandboxClient } from "../sandbox/index.js";
import { resolveRunningId } from "../sandbox/resolve.js";
import {
  instanceExists,
  readConfig,
} from "../instance/index.js";

export const connect = command({
  name: "connect",
  aliases: ["ssh"],
  description: "Open an interactive shell in the instance's sandbox",
  args: {
    instance: positional({ type: string, displayName: "instance", description: "The instance name" }),
  },
  async handler({ instance: instanceName }) {
    if (!instanceExists(instanceName)) {
      console.error(chalk.red(`Instance "${instanceName}" not found.`));
      process.exit(1);
    }

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

    const client = createSandboxClient(instanceName, config);
    const sandboxId = await resolveRunningId(client, deployedUrl, cronSecret);

    console.log(chalk.dim(`Sandbox: ${sandboxId}`));
    console.log(chalk.bold(`Connecting to ${chalk.cyan(instanceName)}...\n`));

    await client.connect(sandboxId);
  },
});

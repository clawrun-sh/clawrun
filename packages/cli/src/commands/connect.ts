import chalk from "chalk";
import { createSandboxClient } from "../sandbox/index.js";
import { resolveRunningId } from "../sandbox/resolve.js";
import {
  instanceExists,
  readConfig,
} from "../instance/index.js";

export async function connectCommand(instance: string): Promise<void> {
  if (!instanceExists(instance)) {
    console.error(chalk.red(`Instance "${instance}" not found.`));
    process.exit(1);
  }

  const config = readConfig(instance);
  if (!config) {
    console.error(chalk.red(`Could not read config for "${instance}".`));
    process.exit(1);
  }

  const { deployedUrl } = config.instance;
  const { cronSecret } = config.secrets;
  if (!deployedUrl || !cronSecret) {
    console.error(chalk.red(`Instance "${instance}" is not fully deployed. Run "cloudclaw deploy ${instance}" first.`));
    process.exit(1);
  }

  const client = createSandboxClient(instance, config);
  const sandboxId = await resolveRunningId(client, deployedUrl, cronSecret);

  console.log(chalk.dim(`Sandbox: ${sandboxId}`));
  console.log(chalk.bold(`Connecting to ${chalk.cyan(instance)}...\n`));

  await client.connect(sandboxId);
}

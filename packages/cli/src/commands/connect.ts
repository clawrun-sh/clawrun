import { command } from "cmd-ts";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { createSandboxClient } from "../sandbox/index.js";
import { resolveRunningId } from "../sandbox/resolve.js";
import { readConfig } from "../instance/index.js";
import { instance } from "../args/instance.js";

export const connect = command({
  name: "connect",
  aliases: ["ssh"],
  description: "Open an interactive shell in the instance's sandbox",
  args: {
    instance,
  },
  async handler({ instance: instanceName }) {
    const config = readConfig(instanceName);
    if (!config) {
      clack.log.error(`Could not read config for "${instanceName}".`);
      process.exit(1);
    }

    const { deployedUrl } = config.instance;
    const { jwtSecret } = config.secrets;
    if (!deployedUrl || !jwtSecret) {
      clack.log.error(
        `Instance "${instanceName}" is not fully deployed. Run "clawrun deploy ${instanceName}" first.`,
      );
      process.exit(1);
    }

    const client = createSandboxClient(instanceName, config);

    const s = clack.spinner();
    s.start(`Connecting to ${instanceName}...`);
    const sandboxId = await resolveRunningId(client, deployedUrl, jwtSecret, s);
    s.stop(`Connected to sandbox ${chalk.dim(sandboxId)}`);

    await client.connect(sandboxId);
  },
});

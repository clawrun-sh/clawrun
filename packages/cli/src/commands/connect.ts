import { command } from "cmd-ts";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { instanceDeployDir, getPlatformProvider } from "@clawrun/sdk";
import { instance } from "../args/instance.js";
import { connectInstance } from "../connect-instance.js";
import { resolveRunningId } from "../sandbox/resolve.js";
import { connectToSandbox } from "../sandbox/connect.js";

export const connect = command({
  name: "connect",
  aliases: ["ssh"],
  description: "Open an interactive shell in the instance's sandbox",
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

    const s = clack.spinner();
    s.start(`Connecting to ${instanceName}...`);
    const sandboxId = await resolveRunningId(conn.instance, s);
    s.stop(`Connected to sandbox ${chalk.dim(sandboxId)}`);

    const deployDir = instanceDeployDir(instanceName);
    const platform = getPlatformProvider(conn.config.instance.provider);
    try {
      await connectToSandbox(sandboxId, deployDir, platform, conn.config.instance.sandboxRoot);
    } catch (err) {
      clack.log.error(
        `Failed to connect to sandbox: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  },
});

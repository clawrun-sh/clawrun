import { command, option, optional, string } from "cmd-ts";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { zeroclawAdapter } from "zeroclaw/adapter";
import { createSandboxClient } from "../sandbox/index.js";
import { readConfig } from "../instance/index.js";
import { resolveRunningId } from "../sandbox/resolve.js";
import { instance } from "../args/instance.js";
import type { CloudClawConfig } from "../instance/config.js";

/**
 * Start an interactive chat REPL with the agent in a deployed instance.
 * Reusable from both the `agent` command and post-deploy flow.
 */
export async function startAgentChat(instanceName: string, config: CloudClawConfig): Promise<void> {
  const { deployedUrl } = config.instance;
  const { cronSecret } = config.secrets;
  if (!deployedUrl || !cronSecret) {
    console.error(chalk.red(`Instance "${instanceName}" is not fully deployed. Run "cloudclaw deploy ${instanceName}" first.`));
    process.exit(1);
  }

  const client = createSandboxClient(instanceName, config);
  const adapter = zeroclawAdapter;

  const sandboxId = await resolveRunningId(client, deployedUrl, cronSecret);

  console.log(chalk.dim(`Sandbox: ${sandboxId}\n`));

  async function sendMessage(msg: string): Promise<{ success: boolean; output: string }> {
    const cmd = adapter.buildCommand(msg);
    const result = await client.exec(sandboxId, cmd.cmd, cmd.args, cmd.env, { timeoutMs: 150_000 });
    const response = adapter.parseResponse(result.stdout, result.stderr, result.exitCode);
    return { success: response.success, output: response.message || response.error || "" };
  }

  // Interactive REPL mode
  console.log(chalk.bold(`Connected to ${chalk.cyan(instanceName)}.`));
  console.log(chalk.dim("Type a message (Ctrl+C to exit).\n"));

  try {
    while (true) {
      const rl = createInterface({ input: stdin, output: stdout });
      let msg: string;
      try {
        msg = await rl.question(chalk.bold("you> "));
      } catch {
        // Ctrl+C / Ctrl+D during input
        rl.close();
        break;
      }
      rl.close();

      if (!msg.trim()) continue;

      const s = clack.spinner();
      s.start("Thinking...");
      try {
        const { success, output } = await sendMessage(msg);
        s.stop("");
        console.log(success ? chalk.green(output) : chalk.red(output));
      } catch (err) {
        s.stop("");
        console.log(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
      }
      console.log();
    }
  } catch {
    // unexpected
  }

  console.log(chalk.dim("\nDisconnected."));
}

export const agent = command({
  name: "agent",
  description: "Chat with the agent running in an instance",
  args: {
    instance,
    message: option({ long: "message", short: "m", type: optional(string), description: "Single message (non-interactive)" }),
  },
  async handler({ instance: instanceName, message }) {
    const config = readConfig(instanceName);
    if (!config) {
      console.error(chalk.red(`Could not read config for "${instanceName}".`));
      process.exit(1);
    }

    // Single-shot mode
    if (message) {
      const { deployedUrl } = config.instance;
      const { cronSecret } = config.secrets;
      if (!deployedUrl || !cronSecret) {
        console.error(chalk.red(`Instance "${instanceName}" is not fully deployed. Run "cloudclaw deploy ${instanceName}" first.`));
        process.exit(1);
      }

      const client = createSandboxClient(instanceName, config);
      const adapter = zeroclawAdapter;
      const sandboxId = await resolveRunningId(client, deployedUrl, cronSecret);

      const cmd = adapter.buildCommand(message);
      const result = await client.exec(sandboxId, cmd.cmd, cmd.args, cmd.env, { timeoutMs: 150_000 });
      const response = adapter.parseResponse(result.stdout, result.stderr, result.exitCode);

      const s = clack.spinner();
      s.start("Thinking...");
      s.stop(response.success ? "Done" : "Error");
      const output = response.message || response.error || "";
      console.log(response.success ? chalk.green(output) : chalk.red(output));
      process.exit(response.success ? 0 : 1);
    }

    // Interactive mode
    await startAgentChat(instanceName, config);
  },
});

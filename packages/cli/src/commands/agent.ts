import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { zeroclawAdapter } from "zeroclaw/adapter";
import { createSandboxClient } from "../sandbox/index.js";
import {
  instanceExists,
  readConfig,
} from "../instance/index.js";
import { resolveRunningId } from "../sandbox/resolve.js";

export async function agentCommand(
  instance: string,
  options: { message?: string },
): Promise<void> {
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
  const adapter = zeroclawAdapter;

  const sandboxId = await resolveRunningId(client, deployedUrl, cronSecret);

  console.log(chalk.dim(`Sandbox: ${sandboxId}\n`));

  async function sendMessage(message: string): Promise<{ success: boolean; output: string }> {
    const command = adapter.buildCommand(message);
    const result = await client.exec(sandboxId, command.cmd, command.args, command.env);
    const response = adapter.parseResponse(result.stdout, result.stderr, result.exitCode);
    return { success: response.success, output: response.message || response.error || "" };
  }

  // Single-shot mode
  if (options.message) {
    const s = clack.spinner();
    s.start("Thinking...");
    const { success, output } = await sendMessage(options.message);
    s.stop(success ? "Done" : "Error");
    console.log(success ? chalk.green(output) : chalk.red(output));
    process.exit(success ? 0 : 1);
  }

  // Interactive REPL mode
  // clack's spinner takes over stdout with ANSI cursor control which
  // corrupts a live readline. The fix: close readline before each
  // spinner, then recreate it after.
  console.log(chalk.bold(`Connected to ${chalk.cyan(instance)}.`));
  console.log(chalk.dim("Type a message (Ctrl+C to exit).\n"));

  try {
    while (true) {
      const rl = createInterface({ input: stdin, output: stdout });
      let message: string;
      try {
        message = await rl.question(chalk.bold("you> "));
      } catch {
        // Ctrl+C / Ctrl+D during input
        rl.close();
        break;
      }
      rl.close();

      if (!message.trim()) continue;

      const s = clack.spinner();
      s.start("Thinking...");
      try {
        const { success, output } = await sendMessage(message);
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

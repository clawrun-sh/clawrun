import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { zeroclawAdapter } from "zeroclaw/adapter";
import type { SandboxClient } from "../sandbox/types.js";
import { createSandboxClient } from "../sandbox/index.js";
import {
  instanceExists,
  readConfig,
} from "../instance/index.js";

/** Find the running sandbox ID, or null. */
async function getRunningId(client: SandboxClient): Promise<string | null> {
  const sandboxes = await client.list();
  const running = sandboxes.find((s) => s.status === "running");
  return running?.id ?? null;
}

/** Trigger heartbeat to start a sandbox, then poll until one is running. */
async function ensureRunning(
  client: SandboxClient,
  deployedUrl: string,
  cronSecret: string,
): Promise<string> {
  process.stdout.write(chalk.dim("Starting sandbox..."));

  await fetch(`${deployedUrl}/api/cron/heartbeat?restart=true`, {
    headers: { Authorization: `Bearer ${cronSecret}` },
  });

  const POLL_INTERVAL_MS = 3_000;
  const POLL_TIMEOUT_MS = 90_000;
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const id = await getRunningId(client);
    if (id) {
      process.stdout.write("\n");
      return id;
    }
    process.stdout.write(".");
  }

  process.stdout.write("\n");
  console.error(chalk.red("Sandbox did not start within 90s."));
  process.exit(1);
}

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

  let sandboxId = await getRunningId(client);
  if (!sandboxId) {
    sandboxId = await ensureRunning(client, deployedUrl, cronSecret);
  }

  console.log(chalk.dim(`Sandbox: ${sandboxId}\n`));

  async function sendMessage(message: string): Promise<{ success: boolean; output: string }> {
    const command = adapter.buildCommand(message);
    const result = await client.exec(sandboxId!, command.cmd, command.args, command.env);
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
  console.log(chalk.bold(`Connected to ${chalk.cyan(instance)}.`));
  console.log(chalk.dim("Type a message (Ctrl+C to exit).\n"));

  const rl = createInterface({ input: stdin, output: stdout });

  try {
    while (true) {
      const message = await rl.question(chalk.bold("you> "));
      if (!message.trim()) continue;

      const s = clack.spinner();
      s.start("Thinking...");
      const { success, output } = await sendMessage(message);
      s.stop(success ? "Done" : "Error");
      console.log(success ? chalk.green(output) : chalk.red(output));
      console.log();
    }
  } catch {
    // readline close (Ctrl+C / Ctrl+D)
  } finally {
    rl.close();
    console.log(chalk.dim("\nDisconnected."));
  }
}

import { command, option, optional, string } from "cmd-ts";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { createAgent } from "@clawrun/agent";
import { createSandboxClient } from "../sandbox/index.js";
import { createSandboxHandle } from "../sandbox/handle.js";
import { readConfig } from "../instance/index.js";
import { resolveRunningId } from "../sandbox/resolve.js";
import { instance } from "../args/instance.js";
import { startChatTUI } from "../tui/chat.js";
import type { ClawRunConfigWithSecrets } from "../instance/config.js";

/** Resolve the workspace root inside a sandbox by querying $HOME. */
async function resolveRoot(
  handle: ReturnType<typeof createSandboxHandle>,
  sandboxRoot: string,
): Promise<string> {
  const result = await handle.runCommand("sh", ["-c", "echo $HOME"]);
  const home = (await result.stdout()).trim();
  if (!home) throw new Error("Could not determine sandbox $HOME");
  return `${home}/${sandboxRoot}`;
}

/**
 * Start an interactive chat REPL with the agent in a deployed instance.
 * Routes messages via `agent.sendMessage()` (single-shot `zeroclaw agent -m`),
 * which executes tools — unlike the daemon's `/webhook` endpoint.
 * Reusable from both the `agent` command and post-deploy flow.
 *
 * @param initialMessage — if provided, sent automatically before the REPL starts
 *   (used post-deploy to kick off the BOOTSTRAP.md onboarding flow).
 */
export async function startAgentChat(
  instanceName: string,
  config: ClawRunConfigWithSecrets,
  opts?: { initialMessage?: string },
): Promise<void> {
  const { deployedUrl } = config.instance;
  const { cronSecret } = config.secrets;
  if (!deployedUrl || !cronSecret) {
    console.error(
      chalk.red(
        `Instance "${instanceName}" is not fully deployed. Run "clawrun deploy ${instanceName}" first.`,
      ),
    );
    process.exit(1);
  }

  const client = createSandboxClient(instanceName, config);

  const sandboxId = await resolveRunningId(client, deployedUrl, cronSecret);
  const handle = createSandboxHandle(client, sandboxId);
  const agent = createAgent(config.agent.name);
  const root = await resolveRoot(handle, config.instance.sandboxRoot ?? ".clawrun");

  await startChatTUI(instanceName, agent, handle, root, sandboxId, {
    initialMessage: opts?.initialMessage,
  });
}

export const agentCommand = command({
  name: "agent",
  aliases: ["tui"],
  description: "Chat with the agent running in an instance",
  args: {
    instance,
    message: option({
      long: "message",
      short: "m",
      type: optional(string),
      description: "Single message (non-interactive)",
    }),
  },
  async handler({ instance: instanceName, message }) {
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
          `Instance "${instanceName}" is not fully deployed. Run "clawrun deploy ${instanceName}" first.`,
        ),
      );
      process.exit(1);
    }

    const client = createSandboxClient(instanceName, config);
    const sandboxId = await resolveRunningId(client, deployedUrl, cronSecret);
    const handle = createSandboxHandle(client, sandboxId);

    // Single-shot mode
    if (message) {
      const agent = createAgent(config.agent.name);
      const root = await resolveRoot(handle, config.instance.sandboxRoot ?? ".clawrun");

      const s = clack.spinner();
      s.start("Thinking...");

      const resp = await agent.sendMessage(handle, root, message, {
        signal: AbortSignal.timeout(150_000),
      });

      s.stop(resp.success ? "Done" : "Error");
      console.log(resp.success ? chalk.green(resp.message) : chalk.red(resp.error ?? resp.message));
      process.exit(resp.success ? 0 : 1);
    }

    // Interactive mode
    await startAgentChat(instanceName, config);
  },
});

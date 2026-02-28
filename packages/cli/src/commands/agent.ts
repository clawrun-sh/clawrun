import { command, option, optional, string } from "cmd-ts";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { readConfig } from "../instance/index.js";
import { resolveRunningId } from "../sandbox/resolve.js";
import { createSandboxClient } from "../sandbox/index.js";
import { signInviteToken } from "@clawrun/auth";
import { instance } from "../args/instance.js";
import { startChatTUI } from "../tui/chat.js";
import { sendChatMessage } from "../chat-client.js";
import type { ClawRunConfigWithSecrets } from "../instance/config.js";

/**
 * Start an interactive chat REPL with the agent in a deployed instance.
 * Signs a JWT locally and routes messages through /api/v1/chat.
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
  const { jwtSecret } = config.secrets;
  if (!deployedUrl || !jwtSecret) {
    clack.log.error(
      `Instance "${instanceName}" is not fully deployed. Run "clawrun deploy ${instanceName}" first.`,
    );
    process.exit(1);
  }

  // Resolve running sandbox ID (for display in header)
  const client = createSandboxClient(instanceName, config);
  const sandboxId = await resolveRunningId(client, deployedUrl, jwtSecret);

  await startChatTUI(instanceName, deployedUrl, jwtSecret, sandboxId, {
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

    // Single-shot mode
    if (message) {
      const s = clack.spinner();
      s.start("Thinking...");

      const jwt = await signInviteToken(jwtSecret);
      const result = await sendChatMessage(deployedUrl, jwt, message, AbortSignal.timeout(150_000));

      if (result.success) {
        s.stop("Done");
        clack.log.success(result.text);
      } else {
        s.stop(chalk.red("Error"));
        clack.log.error(result.error ?? result.text);
      }
      process.exit(result.success ? 0 : 1);
    }

    // Interactive mode
    await startAgentChat(instanceName, config);
  },
});

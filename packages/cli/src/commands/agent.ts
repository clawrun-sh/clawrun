import { command, option, optional, string } from "cmd-ts";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { readConfig } from "@clawrun/sdk";
import type { ClawRunConfigWithSecrets } from "@clawrun/sdk";
import { resolveRunningId } from "../sandbox/resolve.js";
import { connectInstance } from "../connect-instance.js";
import { instance } from "../args/instance.js";
import { startChatTUI } from "../tui/chat.js";

/**
 * Start an interactive chat REPL with the agent in a deployed instance.
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
  const conn = connectInstance(instanceName);
  if (!conn) {
    clack.log.error(
      `Instance "${instanceName}" is not fully deployed. Run "clawrun deploy ${instanceName}" first.`,
    );
    process.exit(1);
  }

  // Resolve running sandbox ID (for display in header)
  const s = clack.spinner();
  s.start("Connecting to sandbox...");
  let sandboxId: string;
  try {
    sandboxId = await resolveRunningId(conn.instance);
    s.stop(`Connected to sandbox ${chalk.dim(sandboxId)}`);
  } catch (err) {
    s.stop(chalk.red("Failed to connect to sandbox"));
    clack.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  await startChatTUI(instanceName, conn.instance, sandboxId, config, {
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

    const conn = connectInstance(instanceName);
    if (!conn) {
      clack.log.error(
        `Instance "${instanceName}" is not fully deployed. Run "clawrun deploy ${instanceName}" first.`,
      );
      process.exit(1);
    }

    // Single-shot mode
    if (message) {
      const s = clack.spinner();
      s.start("Thinking...");

      try {
        const result = await conn.instance.sendMessage(message);
        s.stop("Done");
        const text = result.parts
          .filter((p) => p.type === "text")
          .map((p) => (p as { type: "text"; text: string }).text)
          .join("");
        clack.log.success(text || "(no response)");
        process.exit(0);
      } catch (err) {
        s.stop(chalk.red("Error"));
        clack.log.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    }

    // Interactive mode
    await startAgentChat(instanceName, config);
  },
});

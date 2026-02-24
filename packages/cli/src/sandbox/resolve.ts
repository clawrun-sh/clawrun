import chalk from "chalk";
import * as clack from "@clack/prompts";
import type { SandboxClient } from "./types.js";
import { createApiClient } from "../api.js";

/** Find the running sandbox ID, or null. */
export async function getRunningId(client: SandboxClient): Promise<string | null> {
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
  const spinner = clack.spinner();
  spinner.start("Starting sandbox...");

  const api = createApiClient(deployedUrl, cronSecret);
  await api.post("/api/v1/sandbox/restart");

  const POLL_INTERVAL_MS = 3_000;
  const POLL_TIMEOUT_MS = 90_000;
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const id = await getRunningId(client);
    if (id) {
      spinner.stop(chalk.green("Sandbox started."));
      return id;
    }
  }

  spinner.stop(chalk.red("Sandbox did not start within 90s."));
  process.exit(1);
}

/**
 * Get the running sandbox ID — start one via heartbeat if none found.
 */
export async function resolveRunningId(
  client: SandboxClient,
  deployedUrl: string,
  cronSecret: string,
): Promise<string> {
  const id = await getRunningId(client);
  if (id) return id;
  return ensureRunning(client, deployedUrl, cronSecret);
}

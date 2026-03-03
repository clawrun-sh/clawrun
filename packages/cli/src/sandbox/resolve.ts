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

/** Start a sandbox (wake from snapshot if needed), then poll until one is running. */
async function ensureRunning(
  client: SandboxClient,
  deployedUrl: string,
  jwtSecret: string,
  spinner: ReturnType<typeof clack.spinner>,
): Promise<string> {
  spinner.message("Starting sandbox...");

  const api = createApiClient(deployedUrl, jwtSecret);

  let res: Response;
  try {
    res = await api.post("/api/v1/sandbox/start", {
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    spinner.stop(chalk.red(`Failed to reach deployment: ${msg}`));
    process.exit(1);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    spinner.stop(chalk.red(`Start failed (HTTP ${res.status}): ${body}`));
    process.exit(1);
  }

  const POLL_INTERVAL_MS = 3_000;
  const POLL_TIMEOUT_MS = 90_000;
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    try {
      const id = await getRunningId(client);
      if (id) return id;
    } catch {
      // Provider API may be temporarily unavailable — keep polling
    }
  }

  spinner.stop(chalk.red("Sandbox did not start within 90s."));
  process.exit(1);
}

/**
 * Get the running sandbox ID — start one via restart if none found.
 * Caller owns the spinner lifecycle.
 */
export async function resolveRunningId(
  client: SandboxClient,
  deployedUrl: string,
  jwtSecret: string,
  spinner?: ReturnType<typeof clack.spinner>,
): Promise<string> {
  const id = await getRunningId(client);
  if (id) return id;

  // Create a spinner if the caller didn't provide one
  const s = spinner ?? clack.spinner();
  if (!spinner) s.start("Starting sandbox...");

  return ensureRunning(client, deployedUrl, jwtSecret, s);
}

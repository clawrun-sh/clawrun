import chalk from "chalk";
import * as clack from "@clack/prompts";
import type { ClawRunInstance, SandboxEntry } from "@clawrun/sdk";

type SandboxId = SandboxEntry["id"];

/** Find the running sandbox ID, or null. */
export async function getRunningId(instance: ClawRunInstance): Promise<SandboxId | null> {
  const sandboxes = await instance.sandbox.list();
  const running = sandboxes.find((s) => s.status === "running");
  return running?.id ?? null;
}

/** Start a sandbox (wake from snapshot if needed), then poll until one is running. */
async function ensureRunning(
  instance: ClawRunInstance,
  spinner: ReturnType<typeof clack.spinner>,
): Promise<SandboxId> {
  spinner.message("Starting sandbox...");

  try {
    const result = await instance.start();
    if (result.status === "failed") {
      spinner.stop(chalk.red(`Start failed: ${result.error}`));
      process.exit(1);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    spinner.stop(chalk.red(`Failed to reach deployment: ${msg}`));
    process.exit(1);
  }

  const POLL_INTERVAL_MS = 3_000;
  const POLL_TIMEOUT_MS = 90_000;
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    try {
      const id = await getRunningId(instance);
      if (id) return id;
    } catch {
      // Provider API may be temporarily unavailable — keep polling
    }
  }

  spinner.stop(chalk.red("Sandbox did not start within 90s."));
  process.exit(1);
}

/**
 * Get the running sandbox ID — start one via the SDK if none found.
 * Caller owns the spinner lifecycle.
 */
export async function resolveRunningId(
  instance: ClawRunInstance,
  spinner?: ReturnType<typeof clack.spinner>,
): Promise<SandboxId> {
  const id = await getRunningId(instance);
  if (id) return id;

  // Create a spinner if the caller didn't provide one
  const s = spinner ?? clack.spinner();
  if (!spinner) s.start("Starting sandbox...");

  const runningId = await ensureRunning(instance, s);
  if (!spinner) s.stop("Sandbox ready.");
  return runningId;
}

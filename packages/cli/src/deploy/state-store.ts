import { readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { execa } from "execa";

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

const STATE_VAR_PREFIXES = ["KV_REST_API_", "KV_URL", "KV_REST_URL"];

export interface StateStoreResult {
  success: boolean;
  /** KV env vars (KV_REST_API_URL, KV_REST_API_TOKEN, etc.). Empty on failure. */
  vars: Record<string, string>;
}

function parseEnvFile(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    let value = trimmed.slice(eqIdx + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

function isStateVar(key: string): boolean {
  return STATE_VAR_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export interface StateStore {
  id: string;
  name: string;
  status: string;
  product: string;
  installationId: string;
}

/** Products that can serve as a KV state store. */
const KV_PRODUCTS = ["redis", "kv", "upstash"];

function isKvProduct(product: string): boolean {
  const lower = product.toLowerCase();
  return KV_PRODUCTS.some((p) => lower.includes(p));
}

/**
 * List all Redis/KV stores available on the Vercel account.
 */
export async function listStateStores(): Promise<StateStore[]> {
  try {
    const { stdout } = await execa(
      "vercel",
      ["integration", "list", "--all", "--format=json"],
    );
    const parsed = JSON.parse(stdout) as { resources?: StateStore[] };
    return (parsed.resources ?? []).filter(
      (r) => r.status === "available" && isKvProduct(r.product),
    );
  } catch {
    return [];
  }
}

async function waitForStateStoreVars(linkedDir: string): Promise<boolean> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  process.stdout.write(
    chalk.dim("  Waiting for state store provisioning to complete"),
  );

  while (Date.now() < deadline) {
    try {
      const { stdout } = await execa("vercel", ["env", "ls"], {
        cwd: linkedDir,
      });
      if (stdout.includes("KV_REST_API_URL")) {
        process.stdout.write("\n");
        return true;
      }
    } catch {
      // ignore — keep polling
    }

    process.stdout.write(chalk.dim("."));
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  process.stdout.write("\n");
  return false;
}

/**
 * Connect an existing store to the project via the Vercel API,
 * then pull the resulting env vars.
 */
export async function connectStateStore(
  linkedDir: string,
  store: StateStore,
  projectId: string,
): Promise<StateStoreResult> {
  const spinner = clack.spinner();
  spinner.start(`Connecting store "${store.name}" to project`);

  try {
    await execa("vercel", [
      "api",
      `-X`, `POST`,
      `/v1/integrations/installations/${store.installationId}/resources/${store.id}/connections`,
      `-F`, `projectId=${projectId}`,
    ], { cwd: linkedDir });

    spinner.stop(`Connected "${store.name}" to project.`);
  } catch (err) {
    spinner.stop(`Failed to connect store.`);
    clack.log.error(err instanceof Error ? err.message : String(err));
    return { success: false, vars: {} };
  }

  // Pull env vars that the connection created
  return pullStateVars(linkedDir);
}

/**
 * Provision a new KV store via the Vercel integration marketplace,
 * then pull the resulting env vars.
 *
 * Runs from a directory that has `.vercel/project.json` (a linked project).
 */
export async function provisionStateStore(
  linkedDir: string,
): Promise<StateStoreResult> {
  clack.log.step("Creating new state store...");

  // Check if KV_REST_API_URL is already on this project (already connected)
  try {
    const { stdout } = await execa("vercel", ["env", "ls"], {
      cwd: linkedDir,
    });
    if (stdout.includes("KV_REST_API_URL")) {
      clack.log.info("State store already connected to this project.");
      return pullStateVars(linkedDir);
    }
  } catch {
    // ignore — proceed with provisioning
  }

  // `vercel integration add` exits 0 even when user declines the browser
  // prompt (upstream bug). Check exit code first, then fall back to an
  // immediate env-var check to detect the decline case.
  const addResult = await execa(
    "vercel",
    ["integration", "add", "upstash/upstash-kv"],
    { cwd: linkedDir, stdio: "inherit", reject: false },
  );

  if (addResult.exitCode !== 0) {
    clack.log.warn("State store setup cancelled.");
    return { success: false, vars: {} };
  }

  // Exit code was 0 — check if vars actually appeared. If not, the user
  // declined the browser prompt (vercel CLI bug: returns 0 anyway).
  let found = false;
  try {
    const { stdout } = await execa("vercel", ["env", "ls"], { cwd: linkedDir });
    found = stdout.includes("KV_REST_API_URL");
  } catch {
    // ignore
  }

  if (!found) {
    found = await waitForStateStoreVars(linkedDir);
  }

  if (!found) {
    clack.log.warn("State store setup cancelled.");
    return { success: false, vars: {} };
  }

  clack.log.success("State store provisioned.");
  return pullStateVars(linkedDir);
}

async function pullStateVars(
  linkedDir: string,
): Promise<StateStoreResult> {
  const spinner = clack.spinner();
  spinner.start("Pulling state store environment variables");

  const envTempPath = join(linkedDir, ".env.state.tmp");

  try {
    await execa(
      "vercel",
      ["env", "pull", envTempPath, "--yes", "--environment=production"],
      { cwd: linkedDir },
    );

    const pulled = parseEnvFile(readFileSync(envTempPath, "utf-8"));
    const vars: Record<string, string> = {};
    for (const [key, value] of Object.entries(pulled)) {
      if (isStateVar(key)) {
        vars[key] = value;
      }
    }

    try {
      unlinkSync(envTempPath);
    } catch {
      // ignore
    }

    if (!vars["KV_REST_API_URL"] || !vars["KV_REST_API_TOKEN"]) {
      spinner.stop("State store setup incomplete: missing KV_REST_API_URL or KV_REST_API_TOKEN.");
      return { success: false, vars: {} };
    }

    const count = Object.keys(vars).length;
    spinner.stop(`${count} state store env vars retrieved.`);
    return { success: true, vars };
  } catch {
    spinner.stop("Could not pull state store env vars.");
    return { success: false, vars: {} };
  }
}

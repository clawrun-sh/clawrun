import { readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { execa } from "execa";

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const STORE_NAME = "cloudclaw-state";
const REDIS_VAR_PREFIXES = ["KV_REST_API_", "KV_URL", "KV_REST_URL"];

export interface RedisProvisionResult {
  success: boolean;
  /** Redis-related env vars (KV_REST_API_URL, KV_REST_API_TOKEN, etc.). Empty on failure. */
  redisVars: Record<string, string>;
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

function isRedisVar(key: string): boolean {
  return REDIS_VAR_PREFIXES.some((prefix) => key.startsWith(prefix));
}

interface UpstashResource {
  id: string;
  name: string;
  status: string;
  product: string;
}

/**
 * Check if a `cloudclaw-state` KV store already exists across the account.
 */
async function findExistingStore(): Promise<UpstashResource | null> {
  try {
    const { stdout } = await execa(
      "vercel",
      ["integration", "list", "--all", "--integration", "upstash", "--format=json"],
    );
    const parsed = JSON.parse(stdout) as { resources?: UpstashResource[] };
    const resources = parsed.resources ?? [];
    return resources.find((r) => r.name === STORE_NAME) ?? null;
  } catch {
    return null;
  }
}

async function waitForRedisUrl(linkedDir: string): Promise<boolean> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  process.stdout.write(
    chalk.dim("  Waiting for Redis provisioning to complete"),
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
 * Provision a shared Upstash Redis KV store via the Vercel integration.
 *
 * All CloudClaw instances share one KV store named `cloudclaw-state`.
 * Key isolation is handled at the app layer via CLOUDCLAW_INSTANCE_NAME prefix.
 *
 * Runs from a directory that has `.vercel/project.json` (a linked project).
 *
 * Returns `{ success: true, redisVars }` with Redis env vars on success,
 * or `{ success: false, redisVars: {} }` on failure. Failure is non-fatal —
 * the state store degrades gracefully without Redis.
 */
export async function provisionRedis(
  linkedDir: string,
): Promise<RedisProvisionResult> {
  console.log(chalk.cyan("\nSetting up Redis (Upstash KV)...\n"));

  // Check if KV_REST_API_URL is already on this project (already connected)
  try {
    const { stdout } = await execa("vercel", ["env", "ls"], {
      cwd: linkedDir,
    });
    if (stdout.includes("KV_REST_API_URL")) {
      console.log(
        chalk.dim("  Upstash KV already connected to this project, pulling vars..."),
      );
      return pullRedisVars(linkedDir);
    }
  } catch {
    // ignore — proceed with provisioning
  }

  // Check if a `cloudclaw-state` store already exists on the account
  const existing = await findExistingStore();

  if (existing) {
    // Store exists but isn't connected to this project.
    // Re-running `integration add` with the same name connects it.
    console.log(
      chalk.dim(`  Found existing KV store "${STORE_NAME}", connecting to project...`),
    );
    try {
      await execa(
        "vercel",
        [
          "integration", "add", "upstash/upstash-kv",
          "--name", STORE_NAME,
        ],
        { cwd: linkedDir, stdio: "inherit" },
      );
    } catch {
      console.log(
        chalk.yellow("  Integration add exited — checking for env vars..."),
      );
    }
  } else {
    // First time — create a new KV store named `cloudclaw-state`
    console.log(chalk.dim(`  Creating KV store "${STORE_NAME}"...\n`));
    try {
      await execa(
        "vercel",
        [
          "integration", "add", "upstash/upstash-kv",
          "--name", STORE_NAME,
        ],
        { cwd: linkedDir, stdio: "inherit" },
      );
    } catch {
      console.log(
        chalk.yellow("  Integration add exited — checking for Redis..."),
      );
    }
  }

  // Poll until KV_REST_API_URL appears in project env vars
  const found = await waitForRedisUrl(linkedDir);

  if (!found) {
    console.log(
      chalk.yellow(
        "\n  Redis setup skipped: KV_REST_API_URL not found.\n" +
        "  State store will fall back to Postgres (if available) or in-memory.\n",
      ),
    );
    return { success: false, redisVars: {} };
  }

  console.log(chalk.green("  Redis provisioned!"));
  return pullRedisVars(linkedDir);
}

async function pullRedisVars(
  linkedDir: string,
): Promise<RedisProvisionResult> {
  console.log(chalk.dim("\n  Pulling Redis environment variables..."));

  const envTempPath = join(linkedDir, ".env.redis.tmp");

  try {
    await execa(
      "vercel",
      ["env", "pull", envTempPath, "--yes", "--environment=production"],
      { cwd: linkedDir, stdio: "inherit" },
    );

    const pulled = parseEnvFile(readFileSync(envTempPath, "utf-8"));
    const redisVars: Record<string, string> = {};
    for (const [key, value] of Object.entries(pulled)) {
      if (isRedisVar(key)) {
        redisVars[key] = value;
      }
    }

    try {
      unlinkSync(envTempPath);
    } catch {
      // ignore
    }

    if (!redisVars["KV_REST_API_URL"] || !redisVars["KV_REST_API_TOKEN"]) {
      console.log(
        chalk.yellow(
          "\n  Redis setup incomplete: missing KV_REST_API_URL or KV_REST_API_TOKEN.\n" +
          "  State store will fall back to Postgres (if available) or in-memory.\n",
        ),
      );
      return { success: false, redisVars: {} };
    }

    const count = Object.keys(redisVars).length;
    console.log(chalk.green(`  ${count} Redis env vars retrieved.`));
    return { success: true, redisVars };
  } catch {
    console.log(
      chalk.yellow(
        "\n  Could not pull Redis env vars.\n" +
        "  State store will fall back to Postgres (if available) or in-memory.\n",
      ),
    );
    return { success: false, redisVars: {} };
  }
}

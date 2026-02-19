import { readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { execa } from "execa";

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// DB-related env var prefixes we want to extract from the Vercel pull
const DB_VAR_PREFIXES = [
  "POSTGRES_",
  "DATABASE_",
  "PGHOST",
  "PGUSER",
  "PGPASSWORD",
  "PGDATABASE",
  "NEON_",
];

export interface DatabaseProvisionResult {
  success: boolean;
  /** DB-related env vars (POSTGRES_URL, etc.). Empty on failure. */
  dbVars: Record<string, string>;
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

function isDbVar(key: string): boolean {
  return DB_VAR_PREFIXES.some((prefix) => key.startsWith(prefix));
}

async function waitForPostgresUrl(linkedDir: string): Promise<boolean> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  process.stdout.write(
    chalk.dim("  Waiting for database provisioning to complete"),
  );

  while (Date.now() < deadline) {
    try {
      const { stdout } = await execa("vercel", ["env", "ls"], {
        cwd: linkedDir,
      });
      if (stdout.includes("POSTGRES_URL")) {
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
 * Provision a Neon Postgres database via the Vercel integration.
 *
 * Runs from a directory that has `.vercel/project.json` (a linked project).
 * No deployment is needed — just the project link.
 *
 * Returns `{ success: true, dbVars }` with the database env vars on success,
 * or `{ success: false, dbVars: {} }` on failure. The caller should treat
 * failure as fatal and roll back.
 */
export async function provisionDatabase(
  linkedDir: string,
): Promise<DatabaseProvisionResult> {
  console.log(chalk.cyan("\nSetting up database (Neon Postgres)...\n"));

  // Step 1: Add Neon integration (opens browser for marketplace auth)
  console.log(chalk.dim("  Adding Neon integration to your Vercel project..."));
  console.log(
    chalk.dim(
      "  Complete the setup in your browser when it opens.\n",
    ),
  );

  try {
    await execa("vercel", ["integration", "add", "neon"], {
      cwd: linkedDir,
      stdio: "inherit",
    });
  } catch {
    console.log(
      chalk.yellow("  Neon integration command exited — checking for database..."),
    );
  }

  // Step 2: Poll until POSTGRES_URL appears in project env vars
  const found = await waitForPostgresUrl(linkedDir);

  if (!found) {
    console.error(
      chalk.red(
        "\n  Database setup failed: POSTGRES_URL not found after waiting.\n" +
        "  The database is required. Please ensure the Neon integration\n" +
        "  completed successfully and try again.",
      ),
    );
    return { success: false, dbVars: {} };
  }

  console.log(chalk.green("  Database provisioned!"));

  // Step 3: Pull env vars to extract DB credentials
  console.log(chalk.dim("\n  Pulling database environment variables..."));

  const envTempPath = join(linkedDir, ".env.pulled.tmp");

  try {
    await execa(
      "vercel",
      ["env", "pull", envTempPath, "--yes", "--environment=production"],
      { cwd: linkedDir, stdio: "inherit" },
    );

    // Parse temp file and extract only DB-related vars
    const pulled = parseEnvFile(readFileSync(envTempPath, "utf-8"));
    const dbVars: Record<string, string> = {};
    for (const [key, value] of Object.entries(pulled)) {
      if (isDbVar(key)) {
        dbVars[key] = value;
      }
    }

    // Clean up temp file
    try {
      unlinkSync(envTempPath);
    } catch {
      // ignore
    }

    if (Object.keys(dbVars).length === 0) {
      console.error(
        chalk.red(
          "\n  Database setup failed: could not retrieve database credentials.\n" +
          "  POSTGRES_URL was detected but env pull returned no DB vars.",
        ),
      );
      return { success: false, dbVars: {} };
    }

    const dbCount = Object.keys(dbVars).length;
    console.log(chalk.green(`  ${dbCount} database env vars retrieved.`));
    return { success: true, dbVars };
  } catch {
    console.error(
      chalk.red(
        "\n  Database setup failed: could not pull database env vars.\n" +
        "  Ensure the Neon integration completed and try again.",
      ),
    );
    return { success: false, dbVars: {} };
  }
}

import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
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

function writeEnvFile(
  filePath: string,
  vars: Record<string, string>,
): void {
  const content = Object.entries(vars)
    .map(([key, value]) => `${key}="${value}"`)
    .join("\n");
  writeFileSync(filePath, content + "\n");
}

function isDbVar(key: string): boolean {
  return DB_VAR_PREFIXES.some((prefix) => key.startsWith(prefix));
}

async function waitForPostgresUrl(targetDir: string): Promise<boolean> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  process.stdout.write(
    chalk.dim("  Waiting for database provisioning to complete"),
  );

  while (Date.now() < deadline) {
    try {
      const { stdout } = await execa("vercel", ["env", "ls"], {
        cwd: targetDir,
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

export async function setupDatabase(
  targetDir: string,
  envVars: Record<string, string>,
): Promise<string | null> {
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
      cwd: targetDir,
      stdio: "inherit",
    });
  } catch {
    console.log(
      chalk.yellow("  Neon integration command exited — continuing to check..."),
    );
  }

  // Step 2: Poll until POSTGRES_URL appears in project env vars
  const found = await waitForPostgresUrl(targetDir);

  if (!found) {
    console.log(
      chalk.yellow(
        "  Timed out waiting for database. The app will still work without it (no conversation history).",
      ),
    );
    return null;
  }

  console.log(chalk.green("  Database provisioned!"));

  // Step 3: Pull env vars into a TEMP file, extract only DB vars, merge into .env.local
  // This avoids overwriting .env.local which would wipe CLOUDCLAW_ vars
  console.log(chalk.dim("\n  Pulling database environment variables..."));

  const envLocalPath = join(targetDir, ".env.local");
  const envTempPath = join(targetDir, ".env.pulled.tmp");

  try {
    await execa(
      "vercel",
      ["env", "pull", envTempPath, "--yes", "--environment=production"],
      { cwd: targetDir, stdio: "inherit" },
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

    // Read existing .env.local (has CLOUDCLAW_ vars) and merge DB vars in
    const existing = parseEnvFile(readFileSync(envLocalPath, "utf-8"));
    const merged = { ...existing, ...dbVars };
    writeEnvFile(envLocalPath, merged);

    const dbCount = Object.keys(dbVars).length;
    console.log(chalk.green(`  ${dbCount} database vars added to .env.local (existing vars preserved).`));
  } catch {
    console.log(
      chalk.yellow("  Could not pull env vars locally — not needed for production."),
    );
  }

  // Step 4: Redeploy — Neon vars are project-level, CLOUDCLAW_ vars are project-level
  // (set by persistEnvVarsToProject in deployToVercel). Just trigger a fresh deploy.
  console.log(chalk.cyan("\n  Redeploying to activate database connection...\n"));

  try {
    const { stdout } = await execa(
      "vercel",
      ["deploy", "--prod", "--yes"],
      { cwd: targetDir, stdio: ["inherit", "pipe", "inherit"] },
    );
    const url = stdout.trim().split("\n").pop()?.trim() ?? "";
    console.log(chalk.green("\n  Database is live!"));
    if (url) {
      console.log(chalk.dim(`  Updated deployment: ${url}`));
    }
    return url || null;
  } catch {
    console.log(
      chalk.yellow(
        "  Redeployment failed — the next deploy will pick up the database automatically.",
      ),
    );
    return null;
  }
}

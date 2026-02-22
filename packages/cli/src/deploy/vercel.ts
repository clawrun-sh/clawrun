import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { execa } from "execa";

export interface VercelProjectInfo {
  projectId: string;
  orgId: string;
}

export async function checkPrerequisites(): Promise<void> {
  // Node version
  const nodeVersion = process.versions.node;
  const major = parseInt(nodeVersion.split(".")[0], 10);
  if (major < 20) {
    clack.log.error(`Node.js >= 20 is required. You have v${nodeVersion}.`);
    process.exit(1);
  }
  clack.log.success(`Node.js v${nodeVersion}`);

  // Vercel CLI
  const vercelSpinner = clack.spinner();
  vercelSpinner.start("Checking Vercel CLI");
  try {
    const { stdout } = await execa("vercel", ["--version"]);
    vercelSpinner.stop(`Vercel CLI ${stdout.trim()}`);
  } catch {
    vercelSpinner.stop("Vercel CLI not found");
    clack.log.step("Installing Vercel CLI...");
    try {
      await execa("npm", ["install", "-g", "vercel"], { stdio: "inherit" });
      clack.log.success("Vercel CLI installed.");
    } catch {
      clack.log.error("Failed to install Vercel CLI. Install manually: npm i -g vercel");
      process.exit(1);
    }
  }

  // Vercel auth
  const authSpinner = clack.spinner();
  authSpinner.start("Checking Vercel authentication");
  try {
    const { stdout } = await execa("vercel", ["whoami"]);
    authSpinner.stop(`Logged in as ${chalk.bold(stdout.trim())}`);
  } catch {
    authSpinner.stop("Not logged in to Vercel");
    clack.log.step("Starting Vercel login...");
    try {
      await execa("vercel", ["login"], { stdio: "inherit" });
      clack.log.success("Vercel login successful.");
    } catch {
      clack.log.error("Vercel login failed. Run 'vercel login' manually.");
      process.exit(1);
    }
  }
}

/**
 * Create a Vercel project via the API. Returns { projectId, orgId }.
 * The project is created in the CLI's current team scope.
 */
export async function createVercelProject(name: string): Promise<VercelProjectInfo> {
  console.log(chalk.dim(`  Creating Vercel project "${name}"...`));

  const { stdout } = await execa("vercel", [
    "api", "/v9/projects",
    "-X", "POST",
    "-f", `name=${name}`,
    "--raw",
  ]);
  const project = JSON.parse(stdout) as {
    id?: string;
    accountId?: string;
  };

  if (!project.id || !project.accountId) {
    throw new Error("Vercel API returned an unexpected response (missing id or accountId).");
  }

  console.log(chalk.green(`  Vercel project created: ${name}`));
  return { projectId: project.id, orgId: project.accountId };
}

/**
 * Delete a Vercel project by ID. Throws on failure.
 */
export async function deleteVercelProject(info: VercelProjectInfo): Promise<void> {
  await execa("vercel", [
    "api", `/v9/projects/${info.projectId}?teamId=${info.orgId}`,
    "-X", "DELETE",
    "--raw",
    "--dangerously-skip-permissions",
  ]);
}

/**
 * Write a `.vercel/project.json` in the given directory so that Vercel CLI
 * commands (env, integration, deploy) know which project to target.
 */
export function writeVercelLink(dir: string, info: VercelProjectInfo): void {
  const vercelDir = join(dir, ".vercel");
  mkdirSync(vercelDir, { recursive: true });
  writeFileSync(
    join(vercelDir, "project.json"),
    JSON.stringify({ projectId: info.projectId, orgId: info.orgId }) + "\n",
  );
}

export async function persistEnvVarsToProject(
  targetDir: string,
  envVars: Record<string, string>,
): Promise<void> {
  // Vercel Cron requires CRON_SECRET (exact name) to set the Authorization header
  if (envVars["CLOUDCLAW_CRON_SECRET"] && !envVars["CRON_SECRET"]) {
    envVars = { ...envVars, CRON_SECRET: envVars["CLOUDCLAW_CRON_SECRET"] };
  }

  const entries = Object.entries(envVars);
  if (entries.length === 0) return;

  console.log(chalk.dim("  Persisting env vars to project level..."));

  let succeeded = 0;
  for (const [key, value] of entries) {
    // Remove existing (ignore errors — may not exist yet)
    try {
      await execa("vercel", ["env", "rm", key, "production", "--yes"], {
        cwd: targetDir,
      });
    } catch {
      // doesn't exist, fine
    }

    // Add at project level
    try {
      await execa("vercel", ["env", "add", key, "production"], {
        cwd: targetDir,
        input: value,
      });
      succeeded++;
    } catch {
      console.log(chalk.yellow(`  Warning: could not persist ${key} to project.`));
    }
  }

  console.log(
    chalk.green(`  ${succeeded}/${entries.length} env vars persisted to project.`),
  );
}

function readVercelProject(targetDir: string): VercelProjectInfo | null {
  try {
    const data = JSON.parse(
      readFileSync(join(targetDir, ".vercel", "project.json"), "utf-8"),
    ) as { projectId?: string; orgId?: string };
    if (data.projectId && data.orgId) {
      return { projectId: data.projectId, orgId: data.orgId };
    }
  } catch {
    // .vercel/project.json may not exist yet
  }
  return null;
}

export async function disableDeploymentProtection(targetDir: string): Promise<void> {
  const project = readVercelProject(targetDir);
  if (!project) {
    console.log(chalk.yellow("  Could not read Vercel project config — skipping deployment protection config."));
    return;
  }

  try {
    // Use `vercel api` with PATCH method — the CLI handles auth,
    // so we never need to read token files from disk.
    await execa("vercel", [
      "api",
      `/v9/projects/${project.projectId}?teamId=${project.orgId}`,
      "-X", "PATCH",
      "--input", "-",
      "--raw",
    ], {
      input: JSON.stringify({ ssoProtection: null }),
    });
    console.log(chalk.green("  Deployment protection disabled (SSO bypass)."));
  } catch {
    console.log(chalk.yellow("  Could not disable deployment protection."));
  }
}

export async function deployToVercel(
  targetDir: string,
  envVars: Record<string, string>,
): Promise<string> {
  console.log(chalk.cyan("\nDeploying to Vercel...\n"));

  // Build env args — pass CLOUDCLAW_ vars for this deployment
  const envArgs: string[] = [];
  for (const [key, value] of Object.entries(envVars)) {
    envArgs.push("--env", `${key}=${value}`);
  }

  try {
    const { stdout } = await execa(
      "vercel",
      ["deploy", "--prod", "--yes", "--force", ...envArgs],
      {
        cwd: targetDir,
        stdio: ["inherit", "pipe", "inherit"],
      },
    );

    // The last line of stdout is the deployment URL
    const url = stdout.trim().split("\n").pop()?.trim() ?? "";
    return url;
  } catch (error) {
    console.error(chalk.red("\nDeployment failed."));
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}

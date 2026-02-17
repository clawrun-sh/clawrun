import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import { execa } from "execa";

export async function checkPrerequisites(): Promise<void> {
  // Check Node version
  const nodeVersion = process.versions.node;
  const major = parseInt(nodeVersion.split(".")[0], 10);
  if (major < 20) {
    console.error(chalk.red(`Node.js >= 20 is required. You have v${nodeVersion}.`));
    process.exit(1);
  }
  console.log(chalk.green(`  Node.js v${nodeVersion}`));

  // Check Vercel CLI
  try {
    const { stdout } = await execa("vercel", ["--version"]);
    console.log(chalk.green(`  Vercel CLI ${stdout.trim()}`));
  } catch {
    console.log(chalk.yellow("  Vercel CLI not found. Installing..."));
    try {
      await execa("npm", ["install", "-g", "vercel"], { stdio: "inherit" });
      console.log(chalk.green("  Vercel CLI installed."));
    } catch {
      console.error(chalk.red("  Failed to install Vercel CLI. Install manually: npm i -g vercel"));
      process.exit(1);
    }
  }

  // Check Vercel auth
  try {
    const { stdout } = await execa("vercel", ["whoami"]);
    console.log(chalk.green(`  Logged in as ${stdout.trim()}`));
  } catch {
    console.log(chalk.yellow("  Not logged in to Vercel. Starting login..."));
    try {
      await execa("vercel", ["login"], { stdio: "inherit" });
      console.log(chalk.green("  Vercel login successful."));
    } catch {
      console.error(chalk.red("  Vercel login failed. Run 'vercel login' manually."));
      process.exit(1);
    }
  }
}

export async function persistEnvVarsToProject(
  targetDir: string,
  envVars: Record<string, string>,
): Promise<void> {
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

function getVercelToken(): string | null {
  // Vercel CLI stores auth token in platform-specific config dir
  const paths = [
    join(homedir(), "Library", "Application Support", "com.vercel.cli", "auth.json"),
    join(homedir(), ".config", "vercel", "auth.json"),
    join(homedir(), ".local", "share", "com.vercel.cli", "auth.json"),
  ];

  for (const p of paths) {
    try {
      const data = JSON.parse(readFileSync(p, "utf-8")) as { token?: string };
      if (data.token) return data.token;
    } catch {
      // try next path
    }
  }
  return null;
}

function readVercelProject(targetDir: string): { projectId: string; orgId: string } | null {
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
  const token = getVercelToken();
  if (!token) {
    console.log(chalk.yellow("  Could not find Vercel auth token — skipping deployment protection config."));
    return;
  }

  const project = readVercelProject(targetDir);
  if (!project) {
    console.log(chalk.yellow("  Could not read Vercel project config — skipping deployment protection config."));
    return;
  }

  try {
    const res = await fetch(
      `https://api.vercel.com/v9/projects/${project.projectId}?teamId=${project.orgId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ssoProtection: null }),
      },
    );

    if (res.ok) {
      console.log(chalk.green("  Deployment protection disabled (SSO bypass)."));
    } else {
      console.log(chalk.yellow(`  Could not disable deployment protection (HTTP ${res.status}).`));
    }
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

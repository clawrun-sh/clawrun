import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { confirm } from "@inquirer/prompts";
import { execa } from "execa";

const __dirname = dirname(fileURLToPath(import.meta.url));

// From dist/deploy/ -> packages/cli/ -> packages/ -> repo root -> packages/app
const APP_TEMPLATE_DIR = join(__dirname, "..", "..", "..", "..", "packages", "app");

export async function checkPrerequisites(): Promise<void> {
  // Check Node version
  const nodeVersion = process.versions.node;
  const major = parseInt(nodeVersion.split(".")[0], 10);
  if (major < 20) {
    console.error(chalk.red(`Node.js >= 20 is required. You have v${nodeVersion}.`));
    process.exit(1);
  }
  console.log(chalk.green(`  Node.js v${nodeVersion}`));

  // Check Docker
  try {
    const { stdout } = await execa("docker", ["--version"]);
    console.log(chalk.green(`  ${stdout.trim()}`));
  } catch {
    console.error(chalk.red("  Docker not found. Docker is required to build the agent binary."));
    process.exit(1);
  }

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

export async function scaffoldApp(
  targetDir: string,
  envVars: Record<string, string>,
  useDefaults: boolean
): Promise<void> {
  // Check if target directory exists
  if (existsSync(targetDir)) {
    if (!useDefaults) {
      const overwrite = await confirm({
        message: `Directory ${targetDir} already exists. Overwrite?`,
        default: false,
      });
      if (!overwrite) {
        console.log(chalk.yellow("Aborted."));
        process.exit(0);
      }
    }
  }

  console.log(chalk.cyan(`\nScaffolding app to ${targetDir}...`));

  // Copy app template
  mkdirSync(targetDir, { recursive: true });
  cpSync(APP_TEMPLATE_DIR, targetDir, {
    recursive: true,
    filter: (src) => {
      const name = src.split("/").pop() ?? "";
      return !["node_modules", ".next", ".vercel"].includes(name);
    },
  });

  // Write .env.local
  const envContent = Object.entries(envVars)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  writeFileSync(join(targetDir, ".env.local"), envContent + "\n");

  console.log(chalk.green("  App scaffolded successfully."));
}

async function persistEnvVarsToProject(
  targetDir: string,
  envVars: Record<string, string>,
): Promise<void> {
  console.log(chalk.dim("  Persisting env vars to project level..."));

  let succeeded = 0;
  for (const [key, value] of Object.entries(envVars)) {
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
    chalk.green(`  ${succeeded}/${Object.keys(envVars).length} env vars persisted to project.`),
  );
}

export async function deployToVercel(
  targetDir: string,
  envVars: Record<string, string>
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
      ["deploy", "--prod", "--yes", ...envArgs],
      {
        cwd: targetDir,
        stdio: ["inherit", "pipe", "inherit"],
      }
    );

    // The last line of stdout is the deployment URL
    const url = stdout.trim().split("\n").pop()?.trim() ?? "";

    // Also persist env vars at project level so they survive `vercel env pull`
    // and are available to future deploys without --env flags
    await persistEnvVarsToProject(targetDir, envVars);

    return url;
  } catch (error) {
    console.error(chalk.red("\nDeployment failed."));
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { confirm } from "@inquirer/prompts";
import { execa } from "execa";
import {
  instanceExists,
  getInstance,
  destroyInstance,
  instanceDir,
} from "../instance/index.js";

interface VercelProjectJson {
  projectId?: string;
  orgId?: string;
  projectName?: string;
}

function getVercelProjectName(dir: string): string | null {
  const projectJsonPath = join(dir, ".vercel", "project.json");
  if (!existsSync(projectJsonPath)) return null;

  try {
    const data = JSON.parse(
      readFileSync(projectJsonPath, "utf-8"),
    ) as VercelProjectJson;
    return data.projectName ?? null;
  } catch {
    return null;
  }
}

async function deleteVercelProject(dir: string): Promise<void> {
  const projectName = getVercelProjectName(dir);

  if (!projectName) {
    console.log(
      chalk.yellow("  No Vercel project link found — skipping Vercel project deletion."),
    );
    return;
  }

  console.log(chalk.dim(`  Removing Vercel project "${projectName}"...`));

  try {
    // vercel project rm requires typing the project name to confirm.
    // Pipe it as stdin.
    await execa("vercel", ["project", "rm", projectName], {
      cwd: dir,
      input: projectName,
    });
    console.log(chalk.green("  Vercel project deleted."));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(
      chalk.yellow(`  Could not delete Vercel project: ${msg.slice(0, 200)}`),
    );
  }
}

export async function destroyCommand(
  name: string,
  options: { yes?: boolean },
): Promise<void> {
  if (!instanceExists(name)) {
    console.error(chalk.red(`Instance "${name}" not found.`));
    process.exit(1);
  }

  const meta = getInstance(name);
  const dir = instanceDir(name);

  console.log(chalk.bold(`\nInstance: ${name}`));
  if (meta) {
    console.log(chalk.dim(`  Preset: ${meta.preset}`));
    console.log(chalk.dim(`  Agent: ${meta.agent}`));
    if (meta.deployedUrl) {
      console.log(chalk.dim(`  URL: ${meta.deployedUrl}`));
    }
  }
  console.log(chalk.dim(`  Path: ${dir}`));

  if (!options.yes) {
    const confirmed = await confirm({
      message: `Are you sure you want to destroy instance "${name}"? This will delete the Vercel project and cannot be undone.`,
      default: false,
    });

    if (!confirmed) {
      console.log(chalk.yellow("  Aborted."));
      return;
    }
  }

  // Delete Vercel project first (needs .vercel/ dir to still exist)
  await deleteVercelProject(dir);

  // Remove local instance directory
  destroyInstance(name);
}

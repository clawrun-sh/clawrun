import { command } from "cmd-ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import {
  getInstance,
  destroyInstance,
  instanceDir,
} from "../instance/index.js";
import { deleteVercelProject as deleteVercelProjectApi } from "../deploy/vercel.js";
import { instance } from "../args/instance.js";
import { yes } from "../args/yes.js";

async function deleteVercelProject(dir: string): Promise<void> {
  const projectJsonPath = join(dir, ".vercel", "project.json");
  if (!existsSync(projectJsonPath)) {
    console.log(
      chalk.yellow("  No Vercel project link found — skipping Vercel project deletion."),
    );
    return;
  }

  let projectId: string | undefined;
  let orgId: string | undefined;
  try {
    const data = JSON.parse(readFileSync(projectJsonPath, "utf-8")) as {
      projectId?: string;
      orgId?: string;
    };
    projectId = data.projectId;
    orgId = data.orgId;
  } catch {
    console.log(chalk.yellow("  Could not read Vercel project link — skipping."));
    return;
  }

  if (!projectId || !orgId) {
    console.log(chalk.yellow("  Incomplete Vercel project link — skipping."));
    return;
  }

  console.log(chalk.dim(`  Removing Vercel project (${projectId})...`));

  try {
    await deleteVercelProjectApi({ projectId, orgId });
    console.log(chalk.green("  Vercel project deleted."));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(
      chalk.yellow(`  Could not delete Vercel project: ${msg.slice(0, 200)}`),
    );
  }
}

export const destroy = command({
  name: "destroy",
  aliases: ["rm"],
  description: "Remove an instance",
  args: {
    name: instance,
    yes,
  },
  async handler({ name, yes }) {
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

    if (!yes) {
      const confirmed = await clack.confirm({
        message: `Are you sure you want to destroy instance "${name}"? This will delete the Vercel project and cannot be undone.`,
        initialValue: false,
      });

      if (clack.isCancel(confirmed) || !confirmed) {
        console.log(chalk.yellow("  Aborted."));
        return;
      }

      const confirmation = await clack.text({
        message: `Type ${chalk.bold("delete my project")} to confirm:`,
      });

      if (clack.isCancel(confirmation) || confirmation !== "delete my project") {
        console.log(chalk.yellow("  Aborted."));
        return;
      }
    }

    // Delete Vercel project first (needs .vercel/ dir to still exist)
    await deleteVercelProject(dir);

    // Remove local instance directory
    destroyInstance(name);
  },
});

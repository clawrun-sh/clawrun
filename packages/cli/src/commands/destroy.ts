import { command } from "cmd-ts";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import {
  getInstance,
  destroyInstance,
  instanceDir,
} from "../instance/index.js";
import { getPlatformProvider } from "../platform/index.js";
import { instance } from "../args/instance.js";
import { yes } from "../args/yes.js";

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
        message: `Are you sure you want to destroy instance "${name}"? This will delete the project and cannot be undone.`,
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

    // Delete platform project first (needs project link dir to still exist)
    const platform = getPlatformProvider();
    const handle = platform.readProjectLink(dir);

    if (!handle) {
      console.log(
        chalk.yellow("  No project link found — skipping platform project deletion."),
      );
    } else {
      console.log(chalk.dim(`  Removing project (${handle.projectId})...`));
      try {
        await platform.deleteProject(handle);
        console.log(chalk.green("  Project deleted."));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.log(
          chalk.yellow(`  Could not delete project: ${msg.slice(0, 200)}`),
        );
      }
    }

    // Remove local instance directory
    destroyInstance(name);
  },
});

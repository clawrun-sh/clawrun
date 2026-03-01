import { command } from "cmd-ts";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import {
  getInstance,
  readConfig,
  destroyInstance,
  instanceDir,
  instanceDeployDir,
  instanceAgentDir,
} from "../instance/index.js";
import { getPlatformProvider } from "../platform/index.js";
import { createSandboxClient } from "../sandbox/index.js";
import { createAgent } from "@clawrun/agent";
import { initializeAdapters, teardownWakeHooks } from "@clawrun/channel";
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

    clack.log.step(
      `Instance: ${chalk.bold(name)}` +
        (meta
          ? `\n${chalk.dim(`Preset: ${meta.preset} | Agent: ${meta.agent}`)}` +
            (meta.deployedUrl ? `\n${chalk.dim(`URL: ${meta.deployedUrl}`)}` : "")
          : "") +
        `\n${chalk.dim(`Path: ${dir}`)}`,
    );

    if (!yes) {
      const confirmed = await clack.confirm({
        message: `Are you sure you want to destroy instance "${name}"? This will delete the project and cannot be undone.`,
        initialValue: false,
      });

      if (clack.isCancel(confirmed) || !confirmed) {
        clack.cancel("Aborted.");
        return;
      }

      const confirmation = await clack.text({
        message: `Type ${chalk.bold("delete my project")} to confirm:`,
      });

      if (clack.isCancel(confirmation) || confirmation !== "delete my project") {
        clack.cancel("Aborted.");
        return;
      }
    }

    // Read config before any deletions (needed for hooks + platform)
    const config = readConfig(name);
    if (!config) {
      clack.log.warn("No config found — skipping platform project deletion.");
      destroyInstance(name);
      clack.log.success("Local instance directory removed.");
      return;
    }

    // Unregister wake hooks (e.g. Telegram webhook) before deleting the project.
    // If left active, the platform keeps delivering messages to a dead URL.
    try {
      const agent = createAgent(config.agent.name);
      const agentDir = instanceAgentDir(name);
      const setup = agent.readSetup(agentDir);
      const webhookSecrets = config.secrets?.webhookSecrets ?? {};
      initializeAdapters(setup?.channels ?? {}, webhookSecrets);
      await teardownWakeHooks();
    } catch {
      // Best-effort — don't block destroy if hooks can't be cleaned up.
      // The platform will stop delivering after enough failures anyway.
      clack.log.warn("Could not unregister wake hooks (best-effort, continuing).");
    }

    // Delete platform project (needs project link dir to still exist)
    const platform = getPlatformProvider(config.instance.provider);
    const handle = platform.readProjectLink(instanceDeployDir(name));

    if (!handle) {
      clack.log.warn("No project link found — skipping platform cleanup.");
    } else {
      // Stop running sandboxes and delete snapshots before removing the project
      try {
        const client = createSandboxClient(name, config);

        const sandboxes = await client.list();
        const running = sandboxes.filter((s) => s.status === "running" || s.status === "pending");
        if (running.length > 0) {
          const s = clack.spinner();
          s.start(`Stopping ${running.length} sandbox(es)...`);
          await client.stop(...running.map((s) => s.id));
          s.stop(`Stopped ${running.length} sandbox(es).`);
        }

        const snapshots = await client.listSnapshots();
        if (snapshots.length > 0) {
          const s = clack.spinner();
          s.start(`Deleting ${snapshots.length} snapshot(s)...`);
          await client.deleteSnapshots(...snapshots);
          s.stop(`Deleted ${snapshots.length} snapshot(s).`);
        }
      } catch {
        clack.log.warn("Could not clean up sandboxes/snapshots (best-effort, continuing).");
      }

      const s = clack.spinner();
      s.start(`Removing project (${handle.projectId})...`);
      try {
        await platform.deleteProject(handle);
        s.stop(chalk.green("Project deleted."));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        s.stop(chalk.yellow(`Could not delete project: ${msg.slice(0, 200)}`));
      }
    }

    // Remove local instance directory
    destroyInstance(name);
    clack.log.success("Instance destroyed.");
  },
});

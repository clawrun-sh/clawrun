import { command } from "cmd-ts";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { listInstances } from "@clawrun/sdk";
import type { SandboxEntry } from "@clawrun/sdk";
import { connectInstance } from "../connect-instance.js";

function timeAgo(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatStatus(status: string, width: number): string {
  let colorFn: (s: string) => string;
  switch (status) {
    case "running":
      colorFn = chalk.green;
      break;
    case "stopped":
    case "stopping":
    case "snapshotting":
      colorFn = chalk.yellow;
      break;
    case "failed":
    case "aborted":
      colorFn = chalk.red;
      break;
    default:
      colorFn = chalk.dim;
  }
  return colorFn(status.padEnd(width));
}

export const list = command({
  name: "list",
  aliases: ["ls"],
  description: "List all instances",
  args: {},
  async handler() {
    const instances = listInstances();

    if (instances.length === 0) {
      clack.log.info("No instances found.\n  Create one with: clawrun deploy");
      return;
    }

    // Fetch sandbox info from SDK for each instance in parallel
    const spinner = clack.spinner();
    spinner.start("Fetching sandbox status...");
    const sandboxes = await Promise.all(
      instances.map(async (inst): Promise<SandboxEntry | null> => {
        try {
          const conn = connectInstance(inst.name);
          if (!conn) return null;
          const sbxList = await conn.instance.sandbox.list();
          // Return the first running sandbox, or the most recent one
          return (
            sbxList.find((s) => s.status === "running") ??
            sbxList.sort((a, b) => b.createdAt - a.createdAt)[0] ??
            null
          );
        } catch {
          return null;
        }
      }),
    );
    spinner.stop("Done.");

    console.log(chalk.bold(`\n  Instances (${instances.length}):\n`));

    const nameW = 28;
    const statusW = 14;
    const createdW = 14;
    const agentW = 12;

    console.log(
      chalk.dim(
        `  ${"NAME".padEnd(nameW)}${"SANDBOX".padEnd(statusW)}${"CREATED".padEnd(createdW)}${"AGENT".padEnd(agentW)}URL`,
      ),
    );
    console.log(chalk.dim(`  ${"─".repeat(nameW + statusW + createdW + agentW + 30)}`));

    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i];
      const sbx = sandboxes[i];
      const url = inst.deployedUrl ?? chalk.dim("not deployed");
      const status = sbx ? formatStatus(sbx.status, statusW) : chalk.dim("—".padEnd(statusW));
      const created = sbx
        ? chalk.dim(timeAgo(sbx.createdAt).padEnd(createdW))
        : chalk.dim("—".padEnd(createdW));

      console.log(
        `  ${chalk.cyan(inst.name.padEnd(nameW))}${status}${created}${inst.agent.padEnd(agentW)}${url}`,
      );
    }

    console.log();
  },
});

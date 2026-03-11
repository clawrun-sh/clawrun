import { command } from "cmd-ts";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { listInstances } from "@clawrun/sdk";
import type { SandboxEntry } from "@clawrun/sdk";
import { connectInstance } from "../connect-instance.js";
import { createTable } from "../table.js";

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

function statusColor(status: string): (s: string) => string {
  switch (status) {
    case "running":
      return chalk.green;
    case "stopped":
    case "stopping":
    case "snapshotting":
      return chalk.yellow;
    case "failed":
    case "aborted":
      return chalk.red;
    default:
      return chalk.dim;
  }
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

    // Sort by sandbox createdAt descending (newest first), no-sandbox instances last
    const indexed = instances.map((inst, i) => ({ inst, sbx: sandboxes[i] }));
    indexed.sort((a, b) => (b.sbx?.createdAt ?? 0) - (a.sbx?.createdAt ?? 0));

    console.log(chalk.bold(`\n  Instances (${instances.length}):\n`));

    const table = createTable([
      { label: "NAME", width: 28, color: chalk.cyan },
      { label: "SANDBOX", width: 14 },
      { label: "CREATED", width: 14, color: chalk.dim },
      { label: "AGENT", width: 12 },
      { label: "URL", width: 30 },
    ]);

    for (const { inst, sbx } of indexed) {
      const status = sbx?.status ?? "—";
      table.row({
        NAME: inst.name,
        SANDBOX: { raw: status, display: statusColor(status)(status) },
        CREATED: sbx ? timeAgo(sbx.createdAt) : "—",
        AGENT: inst.agent,
        URL: inst.deployedUrl ?? "not deployed",
      });
    }

    table.print();
    console.log();
  },
});

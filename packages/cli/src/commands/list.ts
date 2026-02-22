import { command } from "cmd-ts";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { listInstances } from "../instance/index.js";

interface SandboxStatus {
  running: boolean;
  sandboxId?: string;
  status?: string;
}

async function fetchSandboxStatus(deployedUrl: string): Promise<SandboxStatus | null> {
  try {
    const res = await fetch(`${deployedUrl}/api/health`, { signal: AbortSignal.timeout(5_000) });
    const data = await res.json() as Record<string, unknown>;
    return (data.sandbox as SandboxStatus) ?? null;
  } catch {
    return null;
  }
}

function formatSandboxStatus(status: SandboxStatus | null, width: number): string {
  let label: string;
  let colorFn: (s: string) => string;
  if (!status) { label = "unreachable"; colorFn = chalk.dim; }
  else if (status.running) { label = "running"; colorFn = chalk.green; }
  else if (status.status === "stopped") { label = "stopped"; colorFn = chalk.yellow; }
  else if (status.status === "failed") { label = "failed"; colorFn = chalk.red; }
  else { label = status.status ?? "stopped"; colorFn = chalk.dim; }
  return colorFn(label.padEnd(width));
}

export const list = command({
  name: "list",
  aliases: ["ls"],
  description: "List all instances",
  args: {},
  async handler() {
    const instances = listInstances();

    if (instances.length === 0) {
      console.log(chalk.dim("No instances found."));
      console.log(
        chalk.dim("  Create one with: cloudclaw deploy zeroclaw-basic"),
      );
      return;
    }

    // Fetch sandbox status for all deployed instances in parallel
    const spinner = clack.spinner();
    spinner.start("Fetching sandbox status...");
    const statuses = await Promise.all(
      instances.map((inst) =>
        inst.deployedUrl ? fetchSandboxStatus(inst.deployedUrl) : Promise.resolve(null),
      ),
    );
    spinner.stop("Done.");

    console.log(chalk.bold(`\n  Instances (${instances.length}):\n`));

    // Table header
    const nameW = 28;
    const presetW = 18;
    const agentW = 12;
    const sandboxW = 14;
    const versionW = 20;

    console.log(
      chalk.dim(
        `  ${"NAME".padEnd(nameW)}${"PRESET".padEnd(presetW)}${"AGENT".padEnd(agentW)}${"SANDBOX".padEnd(sandboxW)}${"APP VERSION".padEnd(versionW)}URL`,
      ),
    );
    console.log(chalk.dim(`  ${"─".repeat(nameW + presetW + agentW + sandboxW + versionW + 30)}`));

    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i];
      const url = inst.deployedUrl ?? chalk.dim("not deployed");
      const sandbox = inst.deployedUrl
        ? formatSandboxStatus(statuses[i], sandboxW)
        : chalk.dim("—".padEnd(sandboxW));
      console.log(
        `  ${chalk.cyan(inst.name.padEnd(nameW))}${inst.preset.padEnd(presetW)}${inst.agent.padEnd(agentW)}${sandbox}${inst.appVersion.padEnd(versionW)}${url}`,
      );
    }

    console.log();
  },
});

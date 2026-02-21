import { command } from "cmd-ts";
import chalk from "chalk";
import { listInstances } from "../instance/index.js";

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

    console.log(chalk.bold(`\n  Instances (${instances.length}):\n`));

    // Table header
    const nameW = 28;
    const presetW = 18;
    const agentW = 12;
    const versionW = 20;

    console.log(
      chalk.dim(
        `  ${"NAME".padEnd(nameW)}${"PRESET".padEnd(presetW)}${"AGENT".padEnd(agentW)}${"APP VERSION".padEnd(versionW)}URL`,
      ),
    );
    console.log(chalk.dim(`  ${"─".repeat(nameW + presetW + agentW + versionW + 30)}`));

    for (const inst of instances) {
      const url = inst.deployedUrl ?? chalk.dim("not deployed");
      console.log(
        `  ${chalk.cyan(inst.name.padEnd(nameW))}${inst.preset.padEnd(presetW)}${inst.agent.padEnd(agentW)}${inst.appVersion.padEnd(versionW)}${url}`,
      );
    }

    console.log();
  },
});

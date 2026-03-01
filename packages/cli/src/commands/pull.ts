import { command } from "cmd-ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { createSandboxClient } from "../sandbox/index.js";
import { getRunningId } from "../sandbox/resolve.js";
import { readConfig, instanceAgentDir } from "../instance/index.js";
import { createAgent } from "@clawrun/agent";
import { instance } from "../args/instance.js";

export const pull = command({
  name: "pull",
  description: "Pull agent runtime state from sandbox to local",
  args: {
    instance,
  },
  async handler({ instance: instanceName }) {
    const config = readConfig(instanceName);
    if (!config) {
      clack.log.error(`Could not read config for "${instanceName}".`);
      process.exit(1);
    }

    const { deployedUrl } = config.instance;
    const { cronSecret } = config.secrets;
    if (!deployedUrl || !cronSecret) {
      clack.log.error(`Instance "${instanceName}" is not fully deployed.`);
      process.exit(1);
    }

    const client = createSandboxClient(instanceName, config);

    // Find running sandbox (don't start one — pull requires an existing sandbox)
    const sandboxId = await getRunningId(client);
    if (!sandboxId) {
      clack.log.error(
        "No running sandbox found. Start one first with a message or `clawrun deploy`.",
      );
      process.exit(1);
    }

    // Resolve sandbox root
    const homeResult = await client.exec(sandboxId, "sh", ["-c", "echo $HOME"]);
    const home = homeResult.stdout.trim();
    if (!home) {
      clack.log.error("Could not determine sandbox $HOME.");
      process.exit(1);
    }
    const remoteAgentDir = `${home}/${config.instance.sandboxRoot}/agent`;

    // List all files in the remote agent/ dir recursively
    const findResult = await client.exec(sandboxId, "sh", [
      "-c",
      `find "${remoteAgentDir}" -type f 2>/dev/null`,
    ]);

    if (findResult.exitCode !== 0 || !findResult.stdout.trim()) {
      clack.log.warn("No files found in sandbox agent directory.");
      return;
    }

    const agent = createAgent(config.agent.name);
    const localOwned = new Set(agent.getLocalOwnedFiles());

    const remoteFiles = findResult.stdout
      .trim()
      .split("\n")
      .map((abs) => abs.slice(remoteAgentDir.length + 1)) // relative path
      .filter((rel) => !localOwned.has(rel));

    if (remoteFiles.length === 0) {
      clack.log.warn("No pullable files found (only config files present).");
      return;
    }

    const agentDir = instanceAgentDir(instanceName);
    const s = clack.spinner();
    s.start(
      `Pulling ${remoteFiles.length} file${remoteFiles.length !== 1 ? "s" : ""} from sandbox...`,
    );

    let pulled = 0;
    let failed = 0;

    for (const relPath of remoteFiles) {
      const remotePath = `${remoteAgentDir}/${relPath}`;
      const data = await client.readFile(sandboxId, remotePath);

      if (data) {
        const localPath = join(agentDir, relPath);
        mkdirSync(dirname(localPath), { recursive: true });
        writeFileSync(localPath, data);
        pulled++;
      } else {
        failed++;
      }
    }

    s.stop(chalk.green("Done."));

    const summary = [
      `${chalk.bold("Pulled:")} ${pulled} file${pulled !== 1 ? "s" : ""}`,
      ...(failed > 0 ? [`${chalk.dim("Failed:")} ${failed} file${failed !== 1 ? "s" : ""}`] : []),
      `${chalk.bold("Destination:")} ${agentDir}`,
      ...remoteFiles.map((relPath) => chalk.dim(`  ${relPath}`)),
    ].join("\n");
    clack.log.info(summary);
  },
});

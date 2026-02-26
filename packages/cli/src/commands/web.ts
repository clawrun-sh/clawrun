import { command } from "cmd-ts";
import chalk from "chalk";
import { execFile } from "node:child_process";
import { readConfig } from "../instance/index.js";
import { signInviteToken } from "@clawrun/auth";
import { instance } from "../args/instance.js";

/** Open a URL in the default browser (cross-platform). */
function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  execFile(cmd, [url]);
}

export const web = command({
  name: "web",
  description: "Open the web chat interface in your browser",
  args: {
    instance,
  },
  async handler({ instance: instanceName }) {
    const config = readConfig(instanceName);
    if (!config) {
      console.error(chalk.red(`Could not read config for "${instanceName}".`));
      process.exit(1);
    }

    const { deployedUrl } = config.instance;
    const { jwtSecret } = config.secrets;
    if (!deployedUrl || !jwtSecret) {
      console.error(
        chalk.red(
          `Instance "${instanceName}" is not fully deployed. Run "clawrun deploy ${instanceName}" first.`,
        ),
      );
      process.exit(1);
    }

    const jwt = await signInviteToken(jwtSecret);
    const url = `${deployedUrl}/auth/accept?token=${jwt}`;

    console.log(chalk.green("Opening chat in browser..."));
    console.log(chalk.dim(`Link expires in 10 minutes. Session lasts 8 hours.`));
    openBrowser(url);
  },
});

import { command } from "cmd-ts";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { instance } from "../args/instance.js";
import { connectInstance } from "../connect-instance.js";
import { openBrowser } from "../open-browser.js";

export const web = command({
  name: "web",
  description: "Open the web dashboard in your browser",
  args: {
    instance,
  },
  async handler({ instance: instanceName }) {
    const conn = connectInstance(instanceName);
    if (!conn) {
      clack.log.error(
        `Instance "${instanceName}" is not fully deployed. Run "clawrun deploy ${instanceName}" first.`,
      );
      process.exit(1);
    }

    const s = clack.spinner();
    s.start("Generating invite link...");
    let url: string;
    try {
      const result = await conn.instance.createInvite();
      url = result.url;
      s.stop("Invite link generated");
    } catch (err) {
      s.stop(chalk.red("Failed to generate invite link"));
      clack.log.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    clack.log.success("Opening dashboard in browser...");
    clack.log.info(chalk.dim("Link expires in 10 minutes. Session lasts 8 hours."));
    openBrowser(url);
  },
});

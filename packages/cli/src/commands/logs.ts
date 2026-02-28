import { command, flag, option, optional, number, string } from "cmd-ts";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { readConfig, instanceDeployDir } from "../instance/index.js";
import { getPlatformProvider } from "../platform/index.js";
import { instance } from "../args/instance.js";

export const logs = command({
  name: "logs",
  description: "Stream runtime logs for a deployed instance",
  args: {
    instance,
    follow: flag({
      long: "follow",
      short: "f",
      description: "Follow log output (stream live)",
    }),
    limit: option({
      type: optional(number),
      long: "limit",
      short: "n",
      description: "Number of log entries to show",
    }),
    json: flag({
      long: "json",
      short: "j",
      description: "Output logs as JSON",
    }),
    query: option({
      type: optional(string),
      long: "query",
      short: "q",
      description: "Filter logs by query string",
    }),
    since: option({
      type: optional(string),
      long: "since",
      description: "Show logs since a specific time (e.g. 1h, 30m, 2d)",
    }),
    level: option({
      type: optional(string),
      long: "level",
      description: "Filter by log level (e.g. error, warn, info)",
    }),
  },
  async handler({ instance: instanceName, follow, limit, json, query, since, level }) {
    const config = readConfig(instanceName);
    if (!config) {
      clack.log.error(`Could not read config for "${instanceName}".`);
      process.exit(1);
    }

    if (!config.instance.deployedUrl) {
      clack.log.error(`Instance "${instanceName}" is not deployed. Run "clawrun deploy" first.`);
      process.exit(1);
    }

    const deployDir = instanceDeployDir(instanceName);
    const platform = getPlatformProvider(config.instance.provider);

    try {
      await platform.streamLogs(config.instance.deployedUrl!, deployDir, {
        follow,
        limit,
        json,
        query,
        since,
        level,
      });
    } catch (err) {
      clack.log.error(`Failed to stream logs: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  },
});

import { command, flag, option, optional, number, string } from "cmd-ts";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import type { LogEntry } from "@clawrun/agent";
import { connectInstance } from "../connect-instance.js";
import { instance } from "../args/instance.js";

/** Pino numeric levels → human labels. */
const LEVEL_LABELS: Record<number, { label: string; color: (s: string) => string }> = {
  10: { label: "TRACE", color: chalk.gray },
  20: { label: "DEBUG", color: chalk.gray },
  30: { label: "INFO", color: chalk.cyan },
  40: { label: "WARN", color: chalk.yellow },
  50: { label: "ERROR", color: chalk.red },
  60: { label: "FATAL", color: chalk.bgRed.white },
};

function levelNum(name: string): number | undefined {
  const map: Record<string, number> = {
    trace: 10,
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
    fatal: 60,
  };
  return map[name.toLowerCase()];
}

function formatEntry(entry: LogEntry): string {
  const ts = new Date(entry.time).toLocaleTimeString();
  const lvl = LEVEL_LABELS[entry.level] ?? { label: `L${entry.level}`, color: chalk.white };
  const tag = entry.tag ? chalk.dim(`[${entry.tag}]`) : "";
  return `${chalk.dim(ts)} ${lvl.color(lvl.label.padEnd(5))} ${tag} ${entry.msg}`;
}

export const logs = command({
  name: "logs",
  description: "Show sandbox logs for a deployed instance",
  args: {
    instance,
    follow: flag({
      long: "follow",
      short: "f",
      description: "Follow log output (poll for new entries)",
    }),
    limit: option({
      type: optional(number),
      long: "limit",
      short: "n",
      description: "Number of log entries to show",
    }),
    level: option({
      type: optional(string),
      long: "level",
      description: "Filter by log level (e.g. error, warn, info)",
    }),
    json: flag({
      long: "json",
      short: "j",
      description: "Output raw JSON entries",
    }),
  },
  async handler({ instance: instanceName, follow, limit, level, json }) {
    const conn = connectInstance(instanceName);
    if (!conn) {
      clack.log.error(`Instance "${instanceName}" is not deployed or config is missing.`);
      process.exit(1);
    }

    const { instance: inst } = conn;
    const minLevel = level ? levelNum(level) : undefined;
    const entryLimit = limit ?? 100;

    let lastTime = 0;

    async function fetchAndPrint(): Promise<boolean> {
      try {
        const result = await inst.readLogs({ limit: entryLimit });
        let entries = result.entries;

        // In follow mode, only show new entries since last poll
        if (lastTime > 0) {
          entries = entries.filter((e) => e.time > lastTime);
        }

        if (minLevel != null) {
          entries = entries.filter((e) => e.level >= minLevel);
        }

        for (const entry of entries) {
          if (json) {
            console.log(JSON.stringify(entry));
          } else {
            console.log(formatEntry(entry));
          }
          if (entry.time > lastTime) lastTime = entry.time;
        }

        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("503") || msg.includes("offline")) {
          console.log(
            chalk.yellow("Sandbox is not running. Start it with: clawrun start " + instanceName),
          );
          return false;
        }
        clack.log.error(`Failed to fetch logs: ${msg}`);
        return false;
      }
    }

    const ok = await fetchAndPrint();
    if (!ok || !follow) return;

    // Poll every 5s for new entries
    const interval = setInterval(async () => {
      const ok = await fetchAndPrint();
      if (!ok) {
        clearInterval(interval);
        process.exit(0);
      }
    }, 5000);

    // Graceful shutdown on Ctrl+C
    process.on("SIGINT", () => {
      clearInterval(interval);
      process.exit(0);
    });
  },
});

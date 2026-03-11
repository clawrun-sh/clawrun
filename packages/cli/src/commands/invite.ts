import { command, option, optional, string } from "cmd-ts";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { instance } from "../args/instance.js";
import { connectInstance } from "../connect-instance.js";
import { generateQR } from "../qr.js";

/** Maximum token lifetime: 7 days. */
const MAX_TTL_MINUTES = 7 * 24 * 60;

/**
 * Parse a human-readable TTL string (e.g. "1h", "30m", "2h", "1d") and
 * return both the TTL in seconds and a human label.
 *
 * Supports: <n>m (minutes), <n>h (hours), <n>d (days).
 * Defaults to 10 minutes if not provided or invalid. Capped at 7 days.
 */
function parseTTL(raw?: string): { seconds: number; label: string } {
  if (!raw) return { seconds: 600, label: "10 minutes" };

  const match = raw.match(/^(\d+)\s*(m|h|d)$/i);
  if (!match) return { seconds: 600, label: "10 minutes" };

  const n = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  const minutesMap: Record<string, number> = { m: 1, h: 60, d: 1440 };
  const totalMinutes = n * minutesMap[unit];

  if (totalMinutes > MAX_TTL_MINUTES) {
    return { seconds: 7 * 24 * 60 * 60, label: "7 days (capped)" };
  }

  const unitLabels: Record<string, string> = {
    m: n === 1 ? "minute" : "minutes",
    h: n === 1 ? "hour" : "hours",
    d: n === 1 ? "day" : "days",
  };

  return {
    seconds: totalMinutes * 60,
    label: `${n} ${unitLabels[unit]}`,
  };
}

export const invite = command({
  name: "invite",
  description: "Generate an invite link (and QR code) for the web chat",
  args: {
    instance,
    ttl: option({
      long: "ttl",
      short: "t",
      type: optional(string),
      description:
        'Invite link lifetime (e.g. "1h", "30m", "2d"). Default: 10m. Session lasts 8h after accepting.',
    }),
  },
  async handler({ instance: instanceName, ttl: rawTTL }) {
    const conn = connectInstance(instanceName);
    if (!conn) {
      clack.log.error(
        `Instance "${instanceName}" is not fully deployed. Run "clawrun deploy ${instanceName}" first.`,
      );
      process.exit(1);
    }

    const { seconds, label } = parseTTL(rawTTL);

    const s = clack.spinner();
    s.start("Generating invite link...");
    let url: string;
    try {
      const result = await conn.instance.createInvite(seconds);
      url = result.url;
      s.stop("Invite link generated");
    } catch (err) {
      s.stop(chalk.red("Failed to generate invite link"));
      clack.log.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    clack.log.success(`Invite link for ${chalk.cyan(instanceName)}`);
    clack.log.info(`Expires in ${label}\n\n${chalk.underline(url)}`);

    // Render QR code to terminal
    const qr = await generateQR(url);
    console.log(qr);
  },
});

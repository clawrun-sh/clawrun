import { command, option, optional, string } from "cmd-ts";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import qrcode from "qrcode-terminal";
import { readConfig } from "../instance/index.js";
import { signInviteToken } from "@clawrun/auth";
import { instance } from "../args/instance.js";

/** Maximum token lifetime: 7 days. */
const MAX_TTL_MINUTES = 7 * 24 * 60;

/**
 * Parse a human-readable TTL string (e.g. "1h", "30m", "2h", "1d") and
 * return both the jose-compatible time span and a human label.
 *
 * Supports: <n>m (minutes), <n>h (hours), <n>d (days).
 * Defaults to "1h" if not provided or invalid. Capped at 7 days.
 */
function parseTTL(raw?: string): { span: string; label: string } {
  if (!raw) return { span: "10m", label: "10 minutes" };

  const match = raw.match(/^(\d+)\s*(m|h|d)$/i);
  if (!match) return { span: "10m", label: "10 minutes" };

  const n = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  const minutesMap: Record<string, number> = { m: 1, h: 60, d: 1440 };
  if (n * minutesMap[unit] > MAX_TTL_MINUTES) {
    return { span: "7d", label: "7 days (capped)" };
  }

  const unitLabels: Record<string, string> = {
    m: n === 1 ? "minute" : "minutes",
    h: n === 1 ? "hour" : "hours",
    d: n === 1 ? "day" : "days",
  };

  return {
    span: `${n}${unit}`,
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
    const config = readConfig(instanceName);
    if (!config) {
      clack.log.error(`Could not read config for "${instanceName}".`);
      process.exit(1);
    }

    const { deployedUrl } = config.instance;
    const { jwtSecret } = config.secrets;
    if (!deployedUrl || !jwtSecret) {
      clack.log.error(
        `Instance "${instanceName}" is not fully deployed. Run "clawrun deploy ${instanceName}" first.`,
      );
      process.exit(1);
    }

    const { span, label } = parseTTL(rawTTL);
    const jwt = await signInviteToken(jwtSecret, span);
    const url = `${deployedUrl}/auth/accept?token=${jwt}`;

    clack.log.success(`Invite link for ${chalk.cyan(instanceName)}`);
    clack.log.info(`Expires in ${label}\n\n${chalk.underline(url)}`);

    // Render QR code to terminal
    qrcode.generate(url, { small: true }, (code: string) => {
      console.log(code);
    });
  },
});

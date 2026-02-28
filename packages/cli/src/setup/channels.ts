import * as clack from "@clack/prompts";
import chalk from "chalk";
import type { Agent, ChannelInfo } from "@clawrun/agent";
import { validateChannel, hasValidator } from "@clawrun/channel";

export interface ChannelSetupResult {
  channels: Record<string, Record<string, string>>;
  channelNames: string[];
}

export async function promptChannels(
  agent: Agent,
  existing?: Record<string, Record<string, string>>,
): Promise<ChannelSetupResult> {
  const supportedChannels = agent.getSupportedChannels();
  const channels: Record<string, Record<string, string>> = {};

  // Seed status from existing config
  const status = new Map<string, "configured" | "failed" | "pending">();
  for (const ch of supportedChannels) {
    status.set(ch.id, existing?.[ch.id] ? "configured" : "pending");
    if (existing?.[ch.id]) channels[ch.id] = { ...existing[ch.id] };
  }

  // Main loop — channel menu with live status
  while (true) {
    const options = supportedChannels.map((ch) => {
      const s = status.get(ch.id) ?? "pending";
      const indicator =
        s === "configured"
          ? chalk.green("\u2713")
          : s === "failed"
            ? chalk.red("\u2717")
            : chalk.dim("\u25CB");
      const hint =
        s === "configured"
          ? "configured"
          : s === "failed"
            ? "failed \u2014 select to retry"
            : undefined;
      return { value: ch.id, label: `${indicator} ${ch.name}`, hint };
    });
    options.push({
      value: "__done__",
      label: `${chalk.green("\u2713")} Done`,
      hint: "finish channel setup",
    });

    const choice = await clack.select({
      message: "Messaging channels",
      options,
    });

    if (clack.isCancel(choice)) {
      clack.cancel("Setup cancelled.");
      process.exit(0);
    }
    if (choice === "__done__") break;

    // Configure selected channel
    const channelId = choice as string;
    const channelInfo = supportedChannels.find((c) => c.id === channelId)!;
    const existingFields = channels[channelId] ?? existing?.[channelId] ?? {};

    const result = await configureChannel(channelId, channelInfo, existingFields);

    if (result === null) {
      // User cancelled mid-channel — back to menu, don't change status
      continue;
    }

    if (result.success) {
      channels[channelId] = result.fields;
      status.set(channelId, "configured");
      clack.log.success(`${channelInfo.name} configured`);
    } else {
      status.set(channelId, "failed");
      clack.log.error(`${channelInfo.name}: ${result.error ?? "setup failed"}`);
    }
  }

  // Print summary
  const configured = supportedChannels
    .filter((ch) => status.get(ch.id) === "configured")
    .map((ch) => chalk.green(ch.name));
  if (configured.length > 0) {
    clack.log.info(`Active channels: ${configured.join(", ")}`);
  }

  return { channels, channelNames: Object.keys(channels) };
}

async function configureChannel(
  channelId: string,
  channelInfo: ChannelInfo,
  existingFields: Record<string, string>,
): Promise<{ success: boolean; fields: Record<string, string>; error?: string } | null> {
  const fields: Record<string, string> = {};

  clack.log.step(`Setting up ${chalk.bold(channelInfo.name)}`);

  for (const field of channelInfo.setupFields) {
    const existingValue = existingFields[field.name];

    // Show guidance bullets before the prompt (e.g. "how to find your user ID")
    if (field.guidance?.length) {
      for (const tip of field.guidance) {
        clack.log.info(chalk.dim(tip));
      }
    }

    if (field.type === "password") {
      const input = await clack.password({
        message: field.label,
        validate: (v) => {
          if (field.required && !v && !existingValue) return `${field.label} is required`;
          return undefined;
        },
      });
      if (clack.isCancel(input)) return null;
      fields[field.name] = (input as string) || existingValue || "";
    } else {
      const input = await clack.text({
        message: field.label,
        placeholder: field.description,
        defaultValue: existingValue ?? field.default ?? "",
        validate: (v) => {
          if (field.required && !v && !existingValue) return `${field.label} is required`;
          return undefined;
        },
      });
      if (clack.isCancel(input)) return null;
      fields[field.name] = (input as string) || existingValue || field.default || "";
    }
  }

  // Validate credentials using standalone validators (matches ZeroClaw's wizard.rs)
  if (hasValidator(channelId)) {
    const s = clack.spinner();
    s.start(`Validating ${channelInfo.name} credentials...`);
    const validation = await validateChannel(channelId, fields);
    if (validation!.ok) {
      s.stop(chalk.green(validation!.message));
    } else {
      s.stop(chalk.red(validation!.message));
      return { success: false, fields, error: validation!.message };
    }
  }

  return { success: true, fields };
}

import { z } from "zod";

// --- Provider ---

export const providerInfoSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().min(1),
  tier: z.enum(["recommended", "fast", "gateway", "specialized", "local"]),
});

export const providerSetupSchema = z.object({
  provider: z.string().min(1),
  apiKey: z.string(), // empty allowed for ollama
  model: z.string().min(1),
  apiUrl: z.string().url().optional(),
});

export const curatedModelSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});

// --- Channel ---

export const channelSetupFieldSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["text", "password", "list"]),
  required: z.boolean(),
  description: z.string().optional(),
  default: z.string().optional(),
  /** Guidance bullets shown before the field prompt. */
  guidance: z.array(z.string()).optional(),
});

export const channelInfoSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  setupFields: z.array(channelSetupFieldSchema).min(1),
  apiDomains: z.array(z.string()).default([]),
  /**
   * Wake hook behavior for this channel.
   * - "programmable": ClawRun auto-registers/deregisters webhooks (e.g. Telegram, Discord)
   * - "always-on": User must configure the webhook URL in the platform dashboard (e.g. Slack, WhatsApp)
   * - undefined: No wake hook support — sandbox must be running for messages to flow
   */
  wakeHook: z.enum(["programmable", "always-on"]).optional(),
  /** Instructions shown after channel setup for always-on wake hook channels. */
  wakeHookInstructions: z.string().optional(),
});

// --- Cost ---

export const costSetupSchema = z.object({
  enabled: z.boolean(),
  inputPerMillion: z.number().min(0),
  outputPerMillion: z.number().min(0),
  dailyLimitUsd: z.number().min(0),
  monthlyLimitUsd: z.number().min(0),
});

// --- Combined setup data ---

export const agentSetupDataSchema = z.object({
  provider: providerSetupSchema,
  channels: z.record(z.string(), z.record(z.string(), z.string())),
  cost: costSetupSchema.optional(),
});

// --- Derived types ---

export type ProviderInfo = z.infer<typeof providerInfoSchema>;
export type ProviderSetup = z.infer<typeof providerSetupSchema>;
export type ChannelSetupField = z.infer<typeof channelSetupFieldSchema>;
export type ChannelInfo = z.infer<typeof channelInfoSchema>;
export type CuratedModel = z.infer<typeof curatedModelSchema>;
export type CostSetupData = z.infer<typeof costSetupSchema>;
export type AgentSetupData = z.infer<typeof agentSetupDataSchema>;

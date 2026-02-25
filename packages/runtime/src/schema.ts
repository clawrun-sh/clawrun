import { z } from "zod";

const stateSchema = z.object({
  url: z.string(),
  token: z.string(),
  readOnlyToken: z.string().optional(),
  kvUrl: z.string().optional(),
});

export const cloudClawConfigSchema = z.object({
  $schema: z.string().optional(),
  instance: z.object({
    name: z.string().default("default"),
    preset: z.string().optional(),
    provider: z.string(),
    deployedUrl: z.string().optional(),
    sandboxRoot: z.string().default(".clawrun"),
  }),
  agent: z.object({
    name: z.string(),
    config: z.string().default("agent/config.toml"),
    bundlePaths: z.array(z.string()).default([]),
  }),
  sandbox: z.object({
    activeDuration: z.number().default(600),
    cronKeepAliveWindow: z.number().default(900),
    cronWakeLeadTime: z.number().default(60),
    resources: z
      .object({
        // Vercel Sandbox API enforces vcpus >= 2.
        vcpus: z.number().int().min(2).max(8).default(2),
      })
      .default({ vcpus: 2 }),
  }),
  secrets: z
    .object({
      cronSecret: z.string(),
      nextAuthSecret: z.string(),
      webhookSecrets: z.record(z.string(), z.string()).optional(),
      sandboxSecret: z.string(),
    })
    .optional(),
  state: stateSchema.optional(),
});

export type ClawRunConfig = z.infer<typeof cloudClawConfigSchema>;

import { z } from "zod";

const stateSchema = z.object({
  url: z.string(),
  token: z.string(),
  readOnlyToken: z.string().optional(),
  kvUrl: z.string().optional(),
});

/** Default values for the sandbox config, used by the Zod schema and importable by other packages. */
export const SANDBOX_DEFAULTS = {
  activeDuration: 600,
  cronKeepAliveWindow: 900,
  cronWakeLeadTime: 60,
  vcpus: 2,
} as const;

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
    activeDuration: z.number().default(SANDBOX_DEFAULTS.activeDuration),
    cronKeepAliveWindow: z.number().default(SANDBOX_DEFAULTS.cronKeepAliveWindow),
    cronWakeLeadTime: z.number().default(SANDBOX_DEFAULTS.cronWakeLeadTime),
    resources: z
      .object({
        // Vercel Sandbox API enforces vcpus >= 2.
        vcpus: z.number().int().min(2).max(8).default(SANDBOX_DEFAULTS.vcpus),
      })
      .default({ vcpus: SANDBOX_DEFAULTS.vcpus }),
    networkPolicy: z
      .union([
        z.literal("allow-all"),
        z.literal("deny-all"),
        z.object({
          allow: z.array(z.string()).optional(),
          subnets: z
            .object({
              allow: z.array(z.string()).optional(),
              deny: z.array(z.string()).optional(),
            })
            .optional(),
        }),
      ])
      .default("allow-all"),
  }),
  secrets: z
    .object({
      cronSecret: z.string(),
      jwtSecret: z.string(),
      webhookSecrets: z.record(z.string(), z.string()).optional(),
      sandboxSecret: z.string(),
    })
    .optional(),
  state: stateSchema.optional(),
});

export type ClawRunConfig = z.infer<typeof cloudClawConfigSchema>;

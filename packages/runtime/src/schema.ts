import { z } from "zod";
import { PROVIDER_IDS } from "@clawrun/provider";

const stateSchema = z.object({
  redisUrl: z.string(),
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
    provider: z.enum(PROVIDER_IDS),
    deployedUrl: z.string().optional(),
    sandboxRoot: z.string().default(".clawrun"),
    platformUrlEnvVars: z.array(z.string()).default([]),
  }),
  agent: z.object({
    name: z.string(),
    config: z.string().default("agent/config.toml"),
    bundlePaths: z.array(z.string()).default([]),
    configPaths: z.array(z.string()).default([]),
    /** Tool IDs selected during deploy. The sidecar installs these at startup. */
    tools: z.array(z.string()).default([]),
  }),
  sandbox: z.object({
    activeDuration: z.number().default(SANDBOX_DEFAULTS.activeDuration),
    cronKeepAliveWindow: z.number().default(SANDBOX_DEFAULTS.cronKeepAliveWindow),
    cronWakeLeadTime: z.number().default(SANDBOX_DEFAULTS.cronWakeLeadTime),
    resources: z
      .object({
        // Minimum vCPU count (current providers require >= 2).
        vcpus: z.number().int().min(2).max(8).default(SANDBOX_DEFAULTS.vcpus),
        /** MB of RAM. Defaults to vcpus * 2048 at runtime if not set. */
        memory: z.number().int().optional(),
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
  serverExternalPackages: z.array(z.string()).default([]),
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

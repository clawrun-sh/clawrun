import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as TOML from "@iarna/toml";
import type { Config as ZeroClawConfig } from "./generated/zeroclaw-config.js";

/**
 * Read and parse the agent's config.toml from a local directory.
 *
 * Used by both the sandbox provisioning path (to generate daemon TOML) and the
 * CLI deploy path (to extract channel env vars).
 *
 * The cast is safe because ZeroClaw's serde validates deserialization at
 * runtime. We provide TypeScript-level visibility into the shape.
 */
export function readParsedConfig(agentDir: string): ZeroClawConfig {
  const configPath = join(agentDir, "config.toml");
  const content = readFileSync(configPath, "utf-8");
  return TOML.parse(content) as unknown as ZeroClawConfig;
}

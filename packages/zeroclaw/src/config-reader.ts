import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as TOML from "@iarna/toml";

/**
 * Read and parse the agent's config.toml from a local directory.
 *
 * Used by both the sandbox provisioning path (to generate daemon TOML) and the
 * CLI deploy path (to extract channel env vars).
 */
export function readParsedConfig(agentDir: string): TOML.JsonMap {
  const configPath = join(agentDir, "config.toml");
  const content = readFileSync(configPath, "utf-8");
  return TOML.parse(content);
}

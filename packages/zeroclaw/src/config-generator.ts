import * as TOML from "@iarna/toml";

/**
 * Convert the full ZeroClaw config JSON (from napi getSavedConfig) to TOML format
 * for writing into the sandbox. Injects gateway overrides for daemon mode.
 */
export function generateDaemonTomlFromJson(configJson: string): string {
  const cfg = JSON.parse(configJson) as TOML.JsonMap;

  // Merge gateway overrides for daemon mode (CloudClaw sandbox)
  cfg.gateway = {
    ...((cfg.gateway as TOML.JsonMap) ?? {}),
    port: 3000,
    host: "0.0.0.0",
    require_pairing: false,
    allow_public_bind: true,
  };

  // Merge autonomy overrides for sandbox
  cfg.autonomy = {
    ...((cfg.autonomy as TOML.JsonMap) ?? {}),
    level: "full",
    require_approval_for_medium_risk: false,
    workspace_only: true,
  };

  return TOML.stringify(cfg);
}

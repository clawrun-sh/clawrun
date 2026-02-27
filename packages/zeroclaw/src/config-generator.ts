import * as TOML from "@iarna/toml";

/**
 * Convert a parsed ZeroClaw config object to TOML format for writing into
 * the sandbox. Injects gateway overrides for daemon mode.
 */
export function generateDaemonToml(config: TOML.JsonMap): string {
  // Shallow-clone so callers' object isn't mutated
  const cfg = { ...config };

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

  // Browser: force agent_browser backend (the only one that works in the
  // sandbox — no system browser or native screenshot tools installed)
  // and ensure allowed_domains is usable.
  const browser = cfg.browser as TOML.JsonMap | undefined;
  if (browser?.enabled) {
    browser.backend = "agent_browser";
    const domains = browser.allowed_domains as string[] | undefined;
    if (!domains || domains.length === 0) {
      browser.allowed_domains = ["*"];
    }
  }

  return TOML.stringify(cfg);
}

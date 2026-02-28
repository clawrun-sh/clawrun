import * as TOML from "@iarna/toml";
import type { Config as ZeroClawConfig } from "./generated/zeroclaw-config.js";
import { DAEMON_PORT, DAEMON_HOST } from "./constants.js";

/**
 * Convert a parsed ZeroClaw config object to TOML format for writing into
 * the sandbox. Injects gateway overrides for daemon mode.
 */
export function generateDaemonToml(config: ZeroClawConfig): string {
  // Shallow-clone so callers' object isn't mutated
  const cfg = { ...config };

  // Gateway: sandbox-specific (port/host/binding) — not user-managed
  cfg.gateway = {
    ...(cfg.gateway ?? {}),
    port: DAEMON_PORT,
    host: DAEMON_HOST,
    require_pairing: false,
    allow_public_bind: true,
  };

  // Browser: force agent_browser backend (the only one that works in the
  // sandbox — no system browser or native screenshot tools installed)
  // and ensure allowed_domains is usable.
  const browser = cfg.browser;
  if (browser?.enabled) {
    browser.backend = "agent_browser";
    const domains = browser.allowed_domains;
    if (!domains || domains.length === 0) {
      browser.allowed_domains = ["*"];
    }
  }

  return TOML.stringify(cfg as TOML.JsonMap);
}

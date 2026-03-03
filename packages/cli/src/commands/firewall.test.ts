import { describe, it, expect } from "vitest";
import {
  domainMatchesWildcard,
  deriveAllowedDomains,
  PROVIDER_DOMAINS,
  CHANNEL_DOMAINS,
} from "./deploy.js";
import type { PlatformProvider } from "../platform/index.js";

// Minimal stub — only getInfraDomains() is called by deriveAllowedDomains()
function stubPlatform(infraDomains: string[]): PlatformProvider {
  return { getInfraDomains: () => infraDomains } as unknown as PlatformProvider;
}

// ---------------------------------------------------------------------------
// domainMatchesWildcard
// ---------------------------------------------------------------------------

describe("domainMatchesWildcard", () => {
  it("matches exact domain", () => {
    expect(domainMatchesWildcard("api.openai.com", "api.openai.com")).toBe(true);
  });

  it("matches leading wildcard (*.example.com)", () => {
    expect(domainMatchesWildcard("foo.example.com", "*.example.com")).toBe(true);
  });

  it("does not match nested subdomain against single-label wildcard", () => {
    // * should match exactly one label, not multiple
    expect(domainMatchesWildcard("a.b.example.com", "*.example.com")).toBe(false);
  });

  it("matches middle wildcard (cdn.*.net)", () => {
    expect(domainMatchesWildcard("cdn.fastly.net", "cdn.*.net")).toBe(true);
  });

  it("does not match unrelated domain", () => {
    expect(domainMatchesWildcard("evil.com", "*.example.com")).toBe(false);
  });

  it("does not match when suffix differs", () => {
    expect(domainMatchesWildcard("api.openai.org", "api.openai.com")).toBe(false);
  });

  it("does not partial-match inside a label", () => {
    // "notexample.com" should NOT match "*.example.com"
    expect(domainMatchesWildcard("notexample.com", "*.example.com")).toBe(false);
  });

  it("handles pattern that is the domain itself (no wildcard)", () => {
    expect(domainMatchesWildcard("relay.damus.io", "relay.damus.io")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deriveAllowedDomains
// ---------------------------------------------------------------------------

describe("deriveAllowedDomains", () => {
  it("includes infra domains from platform", () => {
    const platform = stubPlatform(["*.vercel.app", "*.vercel.sh"]);
    const result = deriveAllowedDomains(platform);

    expect(result.all).toContain("*.vercel.app");
    expect(result.all).toContain("*.vercel.sh");
    expect(result.groups[0].reason).toMatch(/Sandbox lifecycle/i);
  });

  it("adds LLM provider domains when provider is specified", () => {
    const platform = stubPlatform(["*.vercel.app"]);
    const result = deriveAllowedDomains(platform, "openrouter");

    expect(result.all).toContain("openrouter.ai");
    expect(result.groups).toHaveLength(2);
    expect(result.groups[1].reason).toMatch(/openrouter/i);
  });

  it("adds channel domains when channels are specified", () => {
    const platform = stubPlatform(["*.vercel.app"]);
    const result = deriveAllowedDomains(platform, undefined, ["telegram", "discord"]);

    expect(result.all).toContain("api.telegram.org");
    expect(result.all).toContain("discord.com");
    expect(result.all).toContain("gateway.discord.gg");
  });

  it("combines provider + channels without duplicates", () => {
    const platform = stubPlatform(["*.vercel.app"]);
    const result = deriveAllowedDomains(platform, "anthropic", ["telegram"]);

    expect(result.all).toContain("*.vercel.app");
    expect(result.all).toContain("api.anthropic.com");
    expect(result.all).toContain("api.telegram.org");
    // No duplicates
    const unique = [...new Set(result.all)];
    expect(result.all).toEqual(unique);
  });

  it("ignores unknown provider name gracefully", () => {
    const platform = stubPlatform(["*.vercel.app"]);
    const result = deriveAllowedDomains(platform, "unknown-provider");

    // Only infra group
    expect(result.groups).toHaveLength(1);
    expect(result.all).toEqual(["*.vercel.app"]);
  });

  it("ignores unknown channel name gracefully", () => {
    const platform = stubPlatform(["*.vercel.app"]);
    const result = deriveAllowedDomains(platform, undefined, ["nonexistent"]);

    expect(result.groups).toHaveLength(1);
  });

  it("is case-insensitive for provider lookup", () => {
    const platform = stubPlatform([]);
    const result = deriveAllowedDomains(platform, "OpenAI");

    expect(result.all).toContain("api.openai.com");
  });

  it("is case-insensitive for channel lookup", () => {
    const platform = stubPlatform([]);
    const result = deriveAllowedDomains(platform, undefined, ["Telegram"]);

    expect(result.all).toContain("api.telegram.org");
  });

  it("every PROVIDER_DOMAINS entry produces correct domains", () => {
    const platform = stubPlatform([]);
    for (const [name, domains] of Object.entries(PROVIDER_DOMAINS)) {
      const result = deriveAllowedDomains(platform, name);
      for (const d of domains) {
        expect(result.all).toContain(d);
      }
    }
  });

  it("every CHANNEL_DOMAINS entry with domains produces correct domains", () => {
    const platform = stubPlatform([]);
    for (const [name, domains] of Object.entries(CHANNEL_DOMAINS)) {
      if (domains.length === 0) continue;
      const result = deriveAllowedDomains(platform, undefined, [name]);
      for (const d of domains) {
        expect(result.all).toContain(d);
      }
    }
  });
});

import { describe, it, expect } from "vitest";
import { domainMatchesWildcard, deriveAllowedDomains } from "@clawrun/sdk";
import type { Agent } from "@clawrun/agent";

const mockAgent = {
  getModelsFetchEndpoint: (p: string) => {
    const endpoints: Record<string, string> = {
      openai: "https://api.openai.com/v1/models",
      openrouter: "https://openrouter.ai/api/v1/models",
      anthropic: "https://api.anthropic.com/v1/models",
      google: "https://generativelanguage.googleapis.com/v1beta/models",
      groq: "https://api.groq.com/openai/v1/models",
      mistral: "https://api.mistral.ai/v1/models",
      deepseek: "https://api.deepseek.com/v1/models",
    };
    const url = endpoints[p.toLowerCase()];
    if (!url) return null;
    return { url, authHeader: () => ({}) };
  },
  getSupportedChannels: () => [
    { id: "telegram", name: "Telegram", apiDomains: ["api.telegram.org"], setupFields: [] },
    {
      id: "discord",
      name: "Discord",
      apiDomains: ["discord.com", "gateway.discord.gg"],
      setupFields: [],
    },
    { id: "slack", name: "Slack", apiDomains: ["slack.com"], setupFields: [] },
    { id: "whatsapp", name: "WhatsApp", apiDomains: ["graph.facebook.com"], setupFields: [] },
    { id: "matrix", name: "Matrix", apiDomains: ["matrix.org"], setupFields: [] },
    { id: "linq", name: "Linq", apiDomains: ["api.linqapp.com"], setupFields: [] },
    { id: "dingtalk", name: "DingTalk", apiDomains: ["api.dingtalk.com"], setupFields: [] },
    { id: "qq", name: "QQ Official", apiDomains: ["bots.qq.com"], setupFields: [] },
    {
      id: "lark",
      name: "Lark / Feishu",
      apiDomains: ["open.feishu.cn", "open.larksuite.com"],
      setupFields: [],
    },
    {
      id: "nostr",
      name: "Nostr",
      apiDomains: ["relay.damus.io", "nos.lol", "relay.primal.net", "relay.snort.social"],
      setupFields: [],
    },
  ],
} as unknown as Agent;

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
  it("includes infra domains", () => {
    const result = deriveAllowedDomains(mockAgent, ["*.vercel.app", "*.vercel.sh"]);

    expect(result.all).toContain("*.vercel.app");
    expect(result.all).toContain("*.vercel.sh");
    expect(result.groups[0].reason).toMatch(/Sandbox lifecycle/i);
  });

  it("adds LLM provider domains when provider is specified", () => {
    const result = deriveAllowedDomains(mockAgent, ["*.vercel.app"], "openrouter");

    expect(result.all).toContain("openrouter.ai");
    expect(result.groups).toHaveLength(2);
    expect(result.groups[1].reason).toMatch(/openrouter/i);
  });

  it("adds channel domains when channels are specified", () => {
    const result = deriveAllowedDomains(mockAgent, ["*.vercel.app"], undefined, [
      "telegram",
      "discord",
    ]);

    expect(result.all).toContain("api.telegram.org");
    expect(result.all).toContain("discord.com");
    expect(result.all).toContain("gateway.discord.gg");
  });

  it("combines provider + channels without duplicates", () => {
    const result = deriveAllowedDomains(mockAgent, ["*.vercel.app"], "anthropic", ["telegram"]);

    expect(result.all).toContain("*.vercel.app");
    expect(result.all).toContain("api.anthropic.com");
    expect(result.all).toContain("api.telegram.org");
    // No duplicates
    const unique = [...new Set(result.all)];
    expect(result.all).toEqual(unique);
  });

  it("ignores unknown provider name gracefully", () => {
    const result = deriveAllowedDomains(mockAgent, ["*.vercel.app"], "unknown-provider");

    // Only infra group
    expect(result.groups).toHaveLength(1);
    expect(result.all).toEqual(["*.vercel.app"]);
  });

  it("ignores unknown channel name gracefully", () => {
    const result = deriveAllowedDomains(mockAgent, ["*.vercel.app"], undefined, ["nonexistent"]);

    expect(result.groups).toHaveLength(1);
  });

  it("is case-insensitive for channel lookup", () => {
    const result = deriveAllowedDomains(mockAgent, [], undefined, ["Telegram"]);

    expect(result.all).toContain("api.telegram.org");
  });

  it("derives provider domains from agent model endpoint", () => {
    const result = deriveAllowedDomains(mockAgent, [], "openai");
    expect(result.all).toContain("api.openai.com");

    const result2 = deriveAllowedDomains(mockAgent, [], "groq");
    expect(result2.all).toContain("api.groq.com");

    const result3 = deriveAllowedDomains(mockAgent, [], "mistral");
    expect(result3.all).toContain("api.mistral.ai");
  });

  it("derives channel domains from agent channel info", () => {
    const result = deriveAllowedDomains(mockAgent, [], undefined, ["lark"]);
    expect(result.all).toContain("open.feishu.cn");
    expect(result.all).toContain("open.larksuite.com");

    const result2 = deriveAllowedDomains(mockAgent, [], undefined, ["nostr"]);
    expect(result2.all).toContain("relay.damus.io");
    expect(result2.all).toContain("nos.lol");
  });
});

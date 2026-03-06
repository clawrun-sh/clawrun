import { describe, it, expect, vi } from "vitest";
import { domainMatchesWildcard, deriveAllowedDomains } from "./deploy.js";
import { DeployError } from "./errors.js";
import type { DeployStep } from "./types.js";
import type { ProgressEvent } from "@clawrun/provider";
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

describe("domainMatchesWildcard", () => {
  it("matches exact domain", () => {
    expect(domainMatchesWildcard("api.openai.com", "api.openai.com")).toBe(true);
  });

  it("matches wildcard pattern", () => {
    expect(domainMatchesWildcard("my-agent.vercel.app", "*.vercel.app")).toBe(true);
  });

  it("does not match different domain", () => {
    expect(domainMatchesWildcard("api.openai.com", "api.anthropic.com")).toBe(false);
  });

  it("does not match wildcard at different level", () => {
    expect(domainMatchesWildcard("sub.api.vercel.app", "*.vercel.app")).toBe(false);
  });

  it("handles multiple wildcards", () => {
    expect(domainMatchesWildcard("a.b.example.com", "*.*.example.com")).toBe(true);
  });

  it("does not match empty domain", () => {
    expect(domainMatchesWildcard("", "*.example.com")).toBe(false);
  });
});

describe("deriveAllowedDomains", () => {
  it("includes infra domains", () => {
    const result = deriveAllowedDomains(mockAgent, ["infra.example.com"]);
    expect(result.all).toContain("infra.example.com");
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].reason).toContain("Sandbox lifecycle");
  });

  it("includes provider domains", () => {
    const result = deriveAllowedDomains(mockAgent, [], "openai");
    expect(result.all).toContain("api.openai.com");
    expect(result.groups).toHaveLength(2); // infra + provider
  });

  it("includes channel domains", () => {
    const result = deriveAllowedDomains(mockAgent, [], undefined, ["telegram", "discord"]);
    expect(result.all).toContain("api.telegram.org");
    expect(result.all).toContain("discord.com");
    expect(result.all).toContain("gateway.discord.gg");
  });

  it("deduplicates domains", () => {
    const result = deriveAllowedDomains(mockAgent, ["api.openai.com"], "openai");
    const occurrences = result.all.filter((d) => d === "api.openai.com");
    expect(occurrences).toHaveLength(1);
  });

  it("handles unknown provider gracefully", () => {
    const result = deriveAllowedDomains(mockAgent, [], "unknown-provider");
    // Should have only the infra group (empty)
    expect(result.groups).toHaveLength(1);
  });

  it("handles unknown channel gracefully", () => {
    const result = deriveAllowedDomains(mockAgent, [], undefined, ["unknown-channel"]);
    expect(result.groups).toHaveLength(1);
  });

  it("derives provider domain from agent endpoint", () => {
    const result = deriveAllowedDomains(mockAgent, [], "anthropic");
    expect(result.all).toContain("api.anthropic.com");
  });

  it("derives channel domains from agent channel info", () => {
    const result = deriveAllowedDomains(mockAgent, [], undefined, ["lark"]);
    expect(result.all).toContain("open.feishu.cn");
    expect(result.all).toContain("open.larksuite.com");
  });

  it("is case-insensitive for channel lookup", () => {
    const result = deriveAllowedDomains(mockAgent, [], undefined, ["Telegram"]);
    expect(result.all).toContain("api.telegram.org");
  });
});

describe("deploy()", () => {
  it("throws DeployError for unknown preset", async () => {
    // Use dynamic import to get the deploy function with mocked presets
    vi.mock("./presets/index.js", () => ({
      getPreset: vi.fn(() => undefined),
      listPresets: vi.fn(() => []),
      getWorkspaceFiles: vi.fn(() => new Map()),
    }));

    const { deploy } = await import("./deploy.js");

    await expect(
      deploy({
        preset: "nonexistent",
        agent: {
          provider: { provider: "openai", apiKey: "sk-test", model: "gpt-4" },
        },
      }),
    ).rejects.toThrow(DeployError);

    vi.restoreAllMocks();
  });

  it("emits typed DeployProgressEvent with step and message", async () => {
    vi.mock("./presets/index.js", () => ({
      getPreset: vi.fn(() => undefined),
      listPresets: vi.fn(() => []),
      getWorkspaceFiles: vi.fn(() => new Map()),
    }));

    const { deploy } = await import("./deploy.js");

    const events: ProgressEvent<DeployStep>[] = [];
    try {
      await deploy({
        preset: "nonexistent",
        agent: {
          provider: { provider: "openai", apiKey: "sk-test", model: "gpt-4" },
        },
        onProgress: (event: ProgressEvent<DeployStep>) => events.push(event),
      });
    } catch {
      // Expected — unknown preset
    }

    // Should have emitted at least one event before failing
    expect(events.length).toBeGreaterThan(0);

    // Every event should have typed step and message
    for (const event of events) {
      expect(typeof event.step).toBe("string");
      expect(typeof event.message).toBe("string");
      expect(event.step.length).toBeGreaterThan(0);
      expect(event.message.length).toBeGreaterThan(0);
    }

    // First event should be resolve-preset
    expect(events[0].step).toBe("resolve-preset" satisfies DeployStep);

    vi.restoreAllMocks();
  });
});

describe("DeployStep type", () => {
  it("covers all expected steps", () => {
    // This test verifies the type system — if a step is removed from
    // the DeployStep union, TypeScript would flag this array.
    const allSteps: DeployStep[] = [
      "resolve-preset",
      "init-platform",
      "check-prerequisites",
      "detect-tier",
      "create-agent",
      "seed-workspace",
      "generate-secrets",
      "create-project",
      "provision-state",
      "build-config",
      "create-instance",
      "configure-platform",
      "persist-env",
      "deploy",
      "start-sandbox",
      "complete",
      "cleanup",
    ];

    expect(allSteps).toHaveLength(17);
    // All values should be unique
    expect(new Set(allSteps).size).toBe(allSteps.length);
  });
});

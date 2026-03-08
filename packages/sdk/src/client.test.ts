import { describe, it, expect, vi } from "vitest";
import { ClawRunClient } from "./client.js";
import { ClawRunInstance } from "./instance.js";

vi.mock("@clawrun/auth", () => ({
  signUserToken: vi.fn(async () => "jwt"),
  signInviteToken: vi.fn(async () => "invite"),
}));

vi.mock("./deploy.js", () => ({
  deploy: vi.fn(async (options: { name?: string; preset: string }) => ({
    name: options.name ?? "generated-name",
    url: "https://test.vercel.app",
    config: {},
    instance: {},
  })),
}));

describe("ClawRunClient", () => {
  describe("connect", () => {
    it("returns a ClawRunInstance", () => {
      const client = new ClawRunClient();
      const instance = client.connect("https://my-agent.vercel.app", "my-secret");
      expect(instance).toBeInstanceOf(ClawRunInstance);
      expect(instance.webUrl).toBe("https://my-agent.vercel.app");
    });

    it("passes sandbox config to instance", () => {
      const client = new ClawRunClient();
      const instance = client.connect("https://my-agent.vercel.app", "secret", {
        provider: "vercel",
        providerOptions: { projectDir: "/tmp/test" },
      });
      expect(instance).toBeInstanceOf(ClawRunInstance);
    });

    it("passes custom fetch to instance", () => {
      const mockFetch = vi.fn();
      const client = new ClawRunClient({ fetch: mockFetch });
      const instance = client.connect("https://example.com", "secret");
      expect(instance).toBeInstanceOf(ClawRunInstance);
    });
  });

  describe("deploy", () => {
    it("delegates to deploy implementation", async () => {
      const client = new ClawRunClient();
      const result = await client.deploy({
        preset: "starter",
        agent: {
          provider: { provider: "openrouter", apiKey: "sk-test", model: "test" },
        },
      });

      expect(result.url).toBe("https://test.vercel.app");
    });

    it("passes custom name to deploy", async () => {
      const client = new ClawRunClient();
      const result = await client.deploy({
        preset: "starter",
        name: "my-custom-agent",
        agent: {
          provider: { provider: "openrouter", apiKey: "sk-test", model: "test" },
        },
      });

      expect(result.name).toBe("my-custom-agent");
    });
  });
});

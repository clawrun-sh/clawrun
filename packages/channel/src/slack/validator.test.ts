import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validator } from "./validator.js";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("slack validator", () => {
  it("returns ok false when bot_token is missing", async () => {
    const result = await validator.validate({});
    expect(result.ok).toBe(false);
    expect(result.message).toContain("required");
  });

  it("returns workspace name on success", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, team: "My Workspace" }),
    } as any);

    const result = await validator.validate({ bot_token: "xoxb-token" });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("My Workspace");
  });

  it("returns ok false on Slack API error (ok=false)", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: "invalid_auth" }),
    } as any);

    const result = await validator.validate({ bot_token: "xoxb-bad" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("invalid_auth");
  });

  it("returns ok false on HTTP failure", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as any);

    const result = await validator.validate({ bot_token: "xoxb-token" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Connection failed");
  });
});

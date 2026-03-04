import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validator } from "./validator.js";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("discord validator", () => {
  it("returns ok false when bot_token is missing", async () => {
    const result = await validator.validate({});
    expect(result.ok).toBe(false);
    expect(result.message).toContain("required");
  });

  it("returns bot name and enriched fields on full success", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ username: "my_bot" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "app-123", verify_key: "pubkey-hex" }),
      } as Response);

    const result = await validator.validate({ bot_token: "bot-token" });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("my_bot");
    expect(result.enrichedFields?.application_id).toBe("app-123");
    expect(result.enrichedFields?.public_key).toBe("pubkey-hex");
  });

  it("returns ok true without enriched fields when app info fails", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ username: "my_bot" }),
      } as Response)
      .mockResolvedValueOnce({ ok: false } as Response);

    const result = await validator.validate({ bot_token: "bot-token" });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("my_bot");
    expect(result.message).toContain("could not fetch app info");
  });

  it("returns ok false on initial HTTP failure", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);

    const result = await validator.validate({ bot_token: "bad-token" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Connection failed");
  });
});

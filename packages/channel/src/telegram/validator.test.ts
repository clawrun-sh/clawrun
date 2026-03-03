import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validator } from "./validator.js";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("telegram validator", () => {
  it("returns ok false when bot_token is missing", async () => {
    const result = await validator.validate({});
    expect(result.ok).toBe(false);
    expect(result.message).toContain("required");
  });

  it("returns bot username on success", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ result: { username: "my_bot" } }),
    } as any);

    const result = await validator.validate({ bot_token: "123:ABC" });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("@my_bot");
  });

  it("returns ok false on HTTP failure", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as any);

    const result = await validator.validate({ bot_token: "bad-token" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Connection failed");
  });
});

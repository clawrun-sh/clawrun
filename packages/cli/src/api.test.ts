import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock signAdminToken to return a predictable JWT
vi.mock("@clawrun/auth", () => ({
  signAdminToken: vi.fn(async (secret: string) => `jwt-signed-with-${secret}`),
}));

// Mock global fetch — must be done before import
const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));
globalThis.fetch = mockFetch as unknown as typeof fetch;

import { createApiClient } from "./api.js";

beforeEach(() => {
  mockFetch.mockClear();
  mockFetch.mockResolvedValue(new Response("ok"));
});

describe("createApiClient", () => {
  it("signs requests with the provided jwtSecret", async () => {
    const client = createApiClient("https://example.com", "my-jwt-secret");
    await client.post("/test");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/test",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer jwt-signed-with-my-jwt-secret",
        }),
      }),
    );
  });

  it("signs with jwtSecret, not cronSecret", async () => {
    // This test documents the bug we fixed: connect.ts was passing cronSecret
    // instead of jwtSecret to createApiClient
    const client = createApiClient("https://example.com", "correct-jwt-secret");
    await client.get("/health");

    const call = mockFetch.mock.calls[0];
    const headers = call[1].headers as Record<string, string>;

    expect(headers.Authorization).toBe("Bearer jwt-signed-with-correct-jwt-secret");
    expect(headers.Authorization).not.toContain("cron");
  });

  it("passes signal through on POST", async () => {
    const controller = new AbortController();
    const client = createApiClient("https://example.com", "secret");
    await client.post("/start", { signal: controller.signal });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/start",
      expect.objectContaining({
        signal: controller.signal,
      }),
    );
  });

  it("passes signal through on GET", async () => {
    const controller = new AbortController();
    const client = createApiClient("https://example.com", "secret");
    await client.get("/status", { signal: controller.signal });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/status",
      expect.objectContaining({
        signal: controller.signal,
      }),
    );
  });

  it("POST includes JSON body when provided", async () => {
    const client = createApiClient("https://example.com", "secret");
    await client.post("/data", { body: { key: "value" } });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/data",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ key: "value" }),
      }),
    );
  });

  it("POST omits body when not provided", async () => {
    const client = createApiClient("https://example.com", "secret");
    await client.post("/start");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/start",
      expect.objectContaining({
        method: "POST",
        body: undefined,
      }),
    );
  });

  it("includes Content-Type header", async () => {
    const client = createApiClient("https://example.com", "secret");
    await client.post("/test");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
  });
});

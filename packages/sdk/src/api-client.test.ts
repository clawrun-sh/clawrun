import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiClient } from "./api-client.js";
import { ApiError, NetworkError } from "./errors.js";

vi.mock("@clawrun/auth", () => ({
  signUserToken: vi.fn(async (secret: string) => `user-jwt-${secret}`),
}));

describe("ApiClient", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let client: ApiClient;

  beforeEach(() => {
    mockFetch = vi.fn();
    client = new ApiClient("https://example.com", "my-secret", { fetch: mockFetch });
  });

  describe("constructor", () => {
    it("strips trailing slashes from baseUrl", () => {
      const c = new ApiClient("https://example.com///", "secret", { fetch: mockFetch });
      expect(c.url).toBe("https://example.com");
    });

    it("exposes the base URL via getter", () => {
      expect(client.url).toBe("https://example.com");
    });
  });

  describe("post", () => {
    it("sends POST with JSON body and user auth header", async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const result = await client.post("/api/v1/test", { key: "value" });

      expect(result).toEqual({ ok: true });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/api/v1/test",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ key: "value" }),
          headers: expect.objectContaining({
            Authorization: "Bearer user-jwt-my-secret",
            "Content-Type": "application/json",
          }),
        }),
      );
    });

    it("handles non-JSON response body", async () => {
      mockFetch.mockResolvedValue(new Response("plain text", { status: 200 }));
      const result = await client.post("/test");
      expect(result).toBe("plain text");
    });

    it("throws ApiError on non-2xx", async () => {
      mockFetch.mockImplementation(async () => new Response("Not Found", { status: 404 }));

      try {
        await client.post("/test");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).statusCode).toBe(404);
        expect((err as ApiError).responseBody).toBe("Not Found");
      }
    });

    it("throws NetworkError on fetch failure", async () => {
      mockFetch.mockRejectedValue(new TypeError("fetch failed"));
      await expect(client.post("/test")).rejects.toThrow(NetworkError);
    });

    it("passes abort signal", async () => {
      mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));
      const controller = new AbortController();
      await client.post("/test", {}, controller.signal);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: controller.signal }),
      );
    });

    it("sends POST without body when body is undefined", async () => {
      mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));
      await client.post("/test");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ body: undefined }),
      );
    });
  });

  describe("get", () => {
    it("sends GET with user auth header", async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));

      const result = await client.get("/api/v1/health");

      expect(result).toEqual({ status: "ok" });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/api/v1/health",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer user-jwt-my-secret",
          }),
        }),
      );
      // GET should not have a method or body specified
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.not.objectContaining({ method: "POST" }),
      );
    });

    it("throws ApiError on non-2xx with status and body", async () => {
      mockFetch.mockImplementation(async () => new Response("Unauthorized", { status: 401 }));

      try {
        await client.get("/test");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).statusCode).toBe(401);
        expect((err as ApiError).responseBody).toBe("Unauthorized");
      }
    });

    it("throws NetworkError on fetch failure", async () => {
      mockFetch.mockRejectedValue(new Error("DNS resolution failed"));
      await expect(client.get("/test")).rejects.toThrow(NetworkError);
    });
  });

  describe("rawPost", () => {
    it("returns the raw Response", async () => {
      const res = new Response("streaming body", { status: 200 });
      mockFetch.mockResolvedValue(res);

      const result = await client.rawPost("/api/v1/chat", { message: "hi" });
      expect(result).toBe(res);
    });

    it("uses user auth header", async () => {
      mockFetch.mockResolvedValue(new Response("ok", { status: 200 }));

      await client.rawPost("/api/v1/chat", { message: "hi" });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/api/v1/chat",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer user-jwt-my-secret",
          }),
        }),
      );
    });

    it("throws ApiError on non-2xx", async () => {
      mockFetch.mockResolvedValue(new Response("Server Error", { status: 500 }));

      await expect(client.rawPost("/test")).rejects.toThrow(ApiError);
    });

    it("throws NetworkError on fetch failure", async () => {
      mockFetch.mockRejectedValue(new TypeError("connection refused"));
      await expect(client.rawPost("/test")).rejects.toThrow(NetworkError);
    });
  });
});

import { describe, it, expect } from "vitest";
import {
  ClawRunError,
  ApiError,
  NetworkError,
  DeployError,
  ProviderNotConfiguredError,
} from "./errors.js";

describe("ClawRunError", () => {
  it("sets name and message", () => {
    const err = new ClawRunError("something went wrong");
    expect(err.name).toBe("ClawRunError");
    expect(err.message).toBe("something went wrong");
    expect(err).toBeInstanceOf(Error);
  });

  it("accepts cause via ErrorOptions", () => {
    const cause = new Error("root cause");
    const err = new ClawRunError("wrapper", { cause });
    expect(err.cause).toBe(cause);
  });
});

describe("ApiError", () => {
  it("sets statusCode and responseBody", () => {
    const err = new ApiError(404, '{"error":"not found"}');
    expect(err.name).toBe("ApiError");
    expect(err.statusCode).toBe(404);
    expect(err.responseBody).toBe('{"error":"not found"}');
    expect(err.message).toContain("404");
  });

  it("extends ClawRunError", () => {
    const err = new ApiError(500, "internal");
    expect(err).toBeInstanceOf(ClawRunError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe("NetworkError", () => {
  it("sets message and cause", () => {
    const cause = new TypeError("fetch failed");
    const err = new NetworkError("connection refused", { cause });
    expect(err.name).toBe("NetworkError");
    expect(err.message).toBe("connection refused");
    expect(err.cause).toBe(cause);
    expect(err).toBeInstanceOf(ClawRunError);
  });
});

describe("DeployError", () => {
  it("includes step in message", () => {
    const err = new DeployError("create-project", "Vercel API failed");
    expect(err.name).toBe("DeployError");
    expect(err.step).toBe("create-project");
    expect(err.message).toContain("create-project");
    expect(err.message).toContain("Vercel API failed");
    expect(err).toBeInstanceOf(ClawRunError);
  });

  it("preserves cause", () => {
    const cause = new Error("original");
    const err = new DeployError("deploy", "failed", { cause });
    expect(err.cause).toBe(cause);
  });

  it("accepts all DeployStep values", () => {
    // Verify a few representative steps compile and work
    const steps = ["resolve-preset", "provision-state", "deploy", "cleanup"] as const;
    for (const step of steps) {
      const err = new DeployError(step, "test");
      expect(err.step).toBe(step);
    }
  });
});

describe("ProviderNotConfiguredError", () => {
  it("has a descriptive message", () => {
    const err = new ProviderNotConfiguredError();
    expect(err.name).toBe("ProviderNotConfiguredError");
    expect(err.message).toContain("provider not configured");
    expect(err).toBeInstanceOf(ClawRunError);
  });
});

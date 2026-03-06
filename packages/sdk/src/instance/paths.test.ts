import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  clawrunHome,
  instancesDir,
  instanceDir,
  instanceAgentDir,
  instanceDeployDir,
} from "./paths.js";

describe("clawrunHome", () => {
  const originalEnv = process.env.CLAWRUN_HOME;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CLAWRUN_HOME = originalEnv;
    } else {
      delete process.env.CLAWRUN_HOME;
    }
  });

  it("returns CLAWRUN_HOME env var when set", () => {
    process.env.CLAWRUN_HOME = "/custom/path";
    expect(clawrunHome()).toBe("/custom/path");
  });

  it("returns ~/.clawrun when CLAWRUN_HOME is not set", () => {
    delete process.env.CLAWRUN_HOME;
    const home = clawrunHome();
    expect(home).toContain(".clawrun");
    expect(home).not.toContain("undefined");
  });
});

describe("instancesDir", () => {
  it("returns the same as clawrunHome", () => {
    expect(instancesDir()).toBe(clawrunHome());
  });
});

describe("instanceDir", () => {
  const originalEnv = process.env.CLAWRUN_HOME;

  beforeEach(() => {
    process.env.CLAWRUN_HOME = "/tmp/test-clawrun";
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CLAWRUN_HOME = originalEnv;
    } else {
      delete process.env.CLAWRUN_HOME;
    }
  });

  it("returns path under clawrunHome", () => {
    expect(instanceDir("my-instance")).toBe("/tmp/test-clawrun/my-instance");
  });

  it("allows hyphens and underscores", () => {
    expect(instanceDir("my-instance_v2")).toBe("/tmp/test-clawrun/my-instance_v2");
  });

  it("allows names starting with digits", () => {
    expect(instanceDir("123-test")).toBe("/tmp/test-clawrun/123-test");
  });

  // --- Path traversal protection ---

  it("rejects path traversal with ../", () => {
    expect(() => instanceDir("../../../etc")).toThrow();
  });

  it("rejects path traversal with ..\\", () => {
    expect(() => instanceDir("..\\..\\etc")).toThrow();
  });

  it("rejects names with slashes", () => {
    expect(() => instanceDir("foo/bar")).toThrow();
  });

  it("rejects empty name", () => {
    expect(() => instanceDir("")).toThrow();
  });

  it("rejects names with dots only", () => {
    expect(() => instanceDir("..")).toThrow();
  });

  it("rejects names starting with special chars", () => {
    expect(() => instanceDir(".hidden")).toThrow();
    expect(() => instanceDir("-starts-with-dash")).toThrow();
    expect(() => instanceDir("_starts-with-underscore")).toThrow();
  });

  it("rejects names with spaces", () => {
    expect(() => instanceDir("has space")).toThrow();
  });

  it("rejects names with null bytes", () => {
    expect(() => instanceDir("test\0evil")).toThrow();
  });
});

describe("instanceAgentDir", () => {
  beforeEach(() => {
    process.env.CLAWRUN_HOME = "/tmp/test-clawrun";
  });

  afterEach(() => {
    delete process.env.CLAWRUN_HOME;
  });

  it("returns agent subdirectory", () => {
    expect(instanceAgentDir("test")).toBe("/tmp/test-clawrun/test/agent");
  });
});

describe("instanceDeployDir", () => {
  beforeEach(() => {
    process.env.CLAWRUN_HOME = "/tmp/test-clawrun";
  });

  afterEach(() => {
    delete process.env.CLAWRUN_HOME;
  });

  it("returns .deploy subdirectory", () => {
    expect(instanceDeployDir("test")).toBe("/tmp/test-clawrun/test/.deploy");
  });
});

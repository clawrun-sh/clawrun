import { describe, it, expect } from "vitest";
import { buildAgentCommand, buildDaemonCommand, buildCronListCommand } from "./command-builder.js";
import { DAEMON_PORT, DAEMON_HOST } from "./constants.js";

describe("buildAgentCommand", () => {
  it("sets cmd to the provided binary path", () => {
    const result = buildAgentCommand("/usr/bin/zeroclaw", "hello", {});
    expect(result.cmd).toBe("/usr/bin/zeroclaw");
  });

  it("includes 'agent' as the first arg", () => {
    const result = buildAgentCommand("/bin/zc", "hello", {});
    expect(result.args[0]).toBe("agent");
  });

  it("includes '-m' flag as the second arg", () => {
    const result = buildAgentCommand("/bin/zc", "hello", {});
    expect(result.args[1]).toBe("-m");
  });

  it("passes the message as the third arg", () => {
    const result = buildAgentCommand("/bin/zc", "test message", {});
    expect(result.args[2]).toBe("test message");
  });

  it("has exactly 3 args", () => {
    const result = buildAgentCommand("/bin/zc", "hello", {});
    expect(result.args).toHaveLength(3);
  });

  it("sets RUST_LOG to warn in env", () => {
    const result = buildAgentCommand("/bin/zc", "hello", {});
    expect(result.env?.RUST_LOG).toBe("warn");
  });

  it("merges provided env vars", () => {
    const result = buildAgentCommand("/bin/zc", "hello", { API_KEY: "sk-123" });
    expect(result.env?.API_KEY).toBe("sk-123");
  });

  it("allows provided env to override RUST_LOG", () => {
    const result = buildAgentCommand("/bin/zc", "hello", {
      RUST_LOG: "debug",
    });
    expect(result.env?.RUST_LOG).toBe("debug");
  });

  it("preserves RUST_LOG when env has no RUST_LOG override", () => {
    const result = buildAgentCommand("/bin/zc", "hello", { OTHER: "val" });
    expect(result.env?.RUST_LOG).toBe("warn");
  });
});

describe("buildDaemonCommand", () => {
  it("sets cmd to the provided binary path", () => {
    const result = buildDaemonCommand("/usr/bin/zeroclaw", {});
    expect(result.cmd).toBe("/usr/bin/zeroclaw");
  });

  it("includes 'daemon' as the first arg", () => {
    const result = buildDaemonCommand("/bin/zc", {});
    expect(result.args[0]).toBe("daemon");
  });

  it("includes '--port' as the second arg", () => {
    const result = buildDaemonCommand("/bin/zc", {});
    expect(result.args[1]).toBe("--port");
  });

  it("uses DAEMON_PORT as default port", () => {
    const result = buildDaemonCommand("/bin/zc", {});
    expect(result.args[2]).toBe(String(DAEMON_PORT));
  });

  it("includes '--host' as the fourth arg", () => {
    const result = buildDaemonCommand("/bin/zc", {});
    expect(result.args[3]).toBe("--host");
  });

  it("uses DAEMON_HOST as default host", () => {
    const result = buildDaemonCommand("/bin/zc", {});
    expect(result.args[4]).toBe(DAEMON_HOST);
  });

  it("has exactly 5 args", () => {
    const result = buildDaemonCommand("/bin/zc", {});
    expect(result.args).toHaveLength(5);
  });

  it("uses custom port when provided", () => {
    const result = buildDaemonCommand("/bin/zc", {}, { port: 8080 });
    expect(result.args[2]).toBe("8080");
  });

  it("uses custom host when provided", () => {
    const result = buildDaemonCommand("/bin/zc", {}, { host: "127.0.0.1" });
    expect(result.args[4]).toBe("127.0.0.1");
  });

  it("passes env through directly", () => {
    const env = { API_KEY: "sk-test" };
    const result = buildDaemonCommand("/bin/zc", env);
    expect(result.env).toEqual(env);
  });

  it("does not inject RUST_LOG into env", () => {
    const result = buildDaemonCommand("/bin/zc", {});
    expect(result.env).not.toHaveProperty("RUST_LOG");
  });

  it("uses default port when options.port is undefined", () => {
    const result = buildDaemonCommand("/bin/zc", {}, { host: "localhost" });
    expect(result.args[2]).toBe(String(DAEMON_PORT));
  });

  it("uses default host when options.host is undefined", () => {
    const result = buildDaemonCommand("/bin/zc", {}, { port: 9090 });
    expect(result.args[4]).toBe(DAEMON_HOST);
  });
});

describe("buildCronListCommand", () => {
  it("sets cmd to the provided binary path", () => {
    const result = buildCronListCommand("/usr/bin/zeroclaw", {});
    expect(result.cmd).toBe("/usr/bin/zeroclaw");
  });

  it("includes 'cron' as the first arg", () => {
    const result = buildCronListCommand("/bin/zc", {});
    expect(result.args[0]).toBe("cron");
  });

  it("includes 'list' as the second arg", () => {
    const result = buildCronListCommand("/bin/zc", {});
    expect(result.args[1]).toBe("list");
  });

  it("has exactly 2 args", () => {
    const result = buildCronListCommand("/bin/zc", {});
    expect(result.args).toHaveLength(2);
  });

  it("passes env through directly", () => {
    const env = { HOME: "/home/user" };
    const result = buildCronListCommand("/bin/zc", env);
    expect(result.env).toEqual(env);
  });
});

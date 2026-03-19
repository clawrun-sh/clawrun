import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Tests for the instrumentation hook.
 *
 * The instrumentation module (deploy/instrumentation-node.ts) registers agent
 * and provider factories and sets up lifecycle hooks.
 * These tests verify the registration flow end-to-end using the REAL registry
 * modules (no mocks for @clawrun/agent or @clawrun/runtime registries) to
 * catch module-duplication bugs where registerAgent() and getAgent() operate
 * on different singleton maps.
 */

beforeEach(() => {
  vi.resetModules();
});

describe("instrumentation register()", () => {
  it("registerAgentFactory + createAgent share the same factory map", async () => {
    const { registerAgentFactory, createAgent } = await import("@clawrun/agent");

    expect(() => createAgent("test-agent")).toThrow(/Unknown agent/);

    registerAgentFactory(
      "test-agent",
      () => ({ name: "test" }) as unknown as import("@clawrun/agent").Agent,
    );
    const agent = createAgent("test-agent");
    expect(agent).toBeDefined();
    expect((agent as unknown as { name: string }).name).toBe("test");
  });

  it("registerAgent + getAgent share the same agents map (no module duplication)", async () => {
    const { registerAgentFactory, createAgent } = await import("@clawrun/agent");
    const { registerAgent, getAgent } = await import("@clawrun/runtime");

    // Simulate what instrumentation-node.ts does:
    // 1. Factory registration (from agent-zeroclaw/register side-effect)
    registerAgentFactory(
      "zeroclaw",
      () => ({ name: "zeroclaw" }) as unknown as import("@clawrun/agent").Agent,
    );
    // 2. Create instance from factory
    const instance = createAgent("zeroclaw");
    // 3. Register in runtime registry
    registerAgent("zeroclaw", instance);

    // Route handlers call getAgent() — must see the SAME instance
    const retrieved = getAgent("zeroclaw");
    expect(retrieved).toBe(instance);
  });

  it("getAgent() throws with (none) when instrumentation did not run", async () => {
    const { getAgent } = await import("@clawrun/runtime");
    expect(() => getAgent("zeroclaw")).toThrow(/Registered agents: \(none\)/);
  });
});

describe("instrumentation static imports guard", () => {
  it("uses static import strings (not template literals) for agent/provider", () => {
    // Read the actual source file to verify no template literals in imports.
    // This catches regressions where someone changes back to dynamic imports
    // like import(`@clawrun/agent-${name}/register`) which breaks file tracing.
    const source = readFileSync(
      join(__dirname, "..", "deploy", "instrumentation-node.ts"),
      "utf-8",
    );

    expect(source).toContain('"@clawrun/agent-zeroclaw/register"');
    expect(source).toContain('"@clawrun/provider-vercel/register"');

    // Must NOT contain template literal imports (backtick + ${)
    const templateImportPattern = /import\s*\(\s*`[^`]*\$\{/;
    expect(source).not.toMatch(templateImportPattern);
  });

  it("guards Node.js code behind NEXT_RUNTIME check", () => {
    const source = readFileSync(join(__dirname, "..", "deploy", "instrumentation.ts"), "utf-8");

    expect(source).toContain("NEXT_RUNTIME");
    expect(source).toContain('"nodejs"');
    // The main instrumentation.ts must NOT have top-level node:fs or node:path
    expect(source).not.toContain("node:fs");
    expect(source).not.toContain("node:path");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

import { existsSync } from "node:fs";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getBinaryPath", () => {
  let getBinaryPath: typeof import("./binary.js").getBinaryPath;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./binary.js");
    getBinaryPath = mod.getBinaryPath;
  });

  it("returns standard path when binary exists there", () => {
    vi.mocked(existsSync).mockReturnValueOnce(true);

    const path = getBinaryPath("linux-x64");
    expect(path).toContain("zeroclaw-linux-amd64");
  });

  it("falls back to CWD path when standard is missing", () => {
    vi.mocked(existsSync)
      .mockReturnValueOnce(false) // standard path
      .mockReturnValueOnce(true); // CWD path

    const path = getBinaryPath("linux-x64");
    expect(path).toContain("node_modules");
    expect(path).toContain("zeroclaw-linux-amd64");
  });

  it("throws when binary is not found anywhere", () => {
    vi.mocked(existsSync).mockReturnValue(false);

    expect(() => getBinaryPath("linux-x64")).toThrow(/binary not found/i);
  });

  it("uses correct filename for darwin-arm64", () => {
    vi.mocked(existsSync).mockReturnValueOnce(true);

    const path = getBinaryPath("darwin-arm64");
    expect(path).toContain("zeroclaw-darwin-arm64");
  });
});

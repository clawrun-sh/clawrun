import { describe, it, expect, vi } from "vitest";

vi.mock("@clawrun/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clawrun/sdk")>();
  return {
    ...actual,
    instanceDir: (name: string) => `/home/user/.clawrun/${name}`,
  };
});

import { configPath } from "./config.js";

describe("configPath", () => {
  it("returns path to clawrun.json for instance", () => {
    const path = configPath("my-bot");
    expect(path).toBe("/home/user/.clawrun/my-bot/clawrun.json");
  });
});

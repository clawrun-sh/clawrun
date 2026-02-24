import { describe, it, expect } from "vitest";
import { createLogger, logger } from "./index.js";

describe("logger", () => {
  it("exports a root logger", () => {
    expect(logger).toBeDefined();
  });

  it("creates a tagged logger", () => {
    const log = createLogger("test");
    expect(log).toBeDefined();
  });
});

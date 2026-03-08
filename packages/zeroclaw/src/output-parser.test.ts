import { describe, it, expect } from "vitest";
import { parseOutput } from "./output-parser.js";

// ---------------------------------------------------------------------------
// parseOutput
// ---------------------------------------------------------------------------
describe("parseOutput", () => {
  it("exitCode 0 with text returns success", () => {
    const result = parseOutput("Hello world", "", 0);
    expect(result.success).toBe(true);
    expect(result.message).toBe("Hello world");
  });

  it("exitCode 0 with no output returns fallback message", () => {
    const result = parseOutput("", "", 0);
    expect(result.success).toBe(true);
    expect(result.message).toContain("no output");
  });

  it("exitCode !== 0 returns failure with error", () => {
    const result = parseOutput("", "something broke", 1);
    expect(result.success).toBe(false);
    expect(result.error).toBe("something broke");
  });
});

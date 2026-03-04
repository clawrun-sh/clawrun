import { describe, it, expect } from "vitest";
import { parseOutput, parseCronListOutput } from "./output-parser.js";

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

// ---------------------------------------------------------------------------
// parseCronListOutput
// ---------------------------------------------------------------------------
describe("parseCronListOutput", () => {
  it("extracts ISO timestamps from next= fields", () => {
    const futureDate = new Date(Date.now() + 3_600_000).toISOString();
    const stdout = `job1 next=${futureDate}\njob2 next=${futureDate}`;
    const { jobs } = parseCronListOutput(stdout);
    expect(jobs.length).toBe(2);
  });

  it("filters past dates", () => {
    const pastDate = new Date(Date.now() - 3_600_000).toISOString();
    const futureDate = new Date(Date.now() + 3_600_000).toISOString();
    const stdout = `job1 next=${pastDate}\njob2 next=${futureDate}`;
    const { jobs } = parseCronListOutput(stdout);
    expect(jobs.length).toBe(1);
    expect(jobs[0].nextRunAt).toBe(futureDate);
  });

  it("handles empty output", () => {
    const { jobs } = parseCronListOutput("");
    expect(jobs.length).toBe(0);
  });
});

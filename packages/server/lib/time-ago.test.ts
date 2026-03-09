import { describe, it, expect, vi, afterEach } from "vitest";
import { timeAgo } from "@clawrun/ui/lib/time-ago";

describe("timeAgo", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns dash for undefined input", () => {
    expect(timeAgo(undefined)).toBe("—");
  });

  it("returns dash for empty string", () => {
    expect(timeAgo("")).toBe("—");
  });

  it("returns relative seconds for < 60s ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T12:00:30Z"));
    const result = timeAgo("2025-06-01T12:00:00Z");
    expect(result).toMatch(/30 seconds ago/);
  });

  it("returns relative minutes for < 60min ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T12:05:00Z"));
    const result = timeAgo("2025-06-01T12:00:00Z");
    expect(result).toMatch(/5 minutes ago/);
  });

  it("returns relative hours for < 24h ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T15:00:00Z"));
    const result = timeAgo("2025-06-01T12:00:00Z");
    expect(result).toMatch(/3 hours ago/);
  });

  it("returns relative days for < 30d ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-08T12:00:00Z"));
    const result = timeAgo("2025-06-01T12:00:00Z");
    expect(result).toMatch(/7 days ago/);
  });

  it("returns relative months for >= 30d ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-09-01T12:00:00Z"));
    const result = timeAgo("2025-06-01T12:00:00Z");
    expect(result).toMatch(/3 months ago/);
  });

  it("handles future dates (negative relative time)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T12:00:00Z"));
    const result = timeAgo("2025-06-01T12:05:00Z");
    expect(result).toMatch(/in 5 minutes/);
  });

  it("returns 'now' or '0 seconds ago' for same time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T12:00:00Z"));
    const result = timeAgo("2025-06-01T12:00:00Z");
    // Intl.RelativeTimeFormat with numeric: "auto" returns "now" for 0 seconds
    expect(result).toMatch(/now|0 seconds ago/);
  });
});

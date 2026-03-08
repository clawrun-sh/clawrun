import { describe, it, expect } from "vitest";
import { GracePeriodReason, FileActivityReason, CronScheduleReason } from "./extend-reasons.js";
import { sandboxId } from "@clawrun/provider";

const basePayload = {
  sandboxId: sandboxId("sbx-1"),
  lastChangedAt: 0,
  root: "/agent",
  daemonStatus: "running" as const,
  daemonRestarts: 0,
};

// ---------------------------------------------------------------------------
// GracePeriodReason
// ---------------------------------------------------------------------------
describe("GracePeriodReason", () => {
  const reason = new GracePeriodReason(60_000); // 60s

  it("returns reason when within grace period", () => {
    const now = 1000;
    const payload = { ...basePayload, sandboxCreatedAt: 500 };
    const result = reason.evaluate(payload, now);
    expect(result).not.toBeNull();
    expect(result).toContain("grace period");
  });

  it("returns null when grace period expired", () => {
    const now = 100_000;
    const payload = { ...basePayload, sandboxCreatedAt: 1000 };
    const result = reason.evaluate(payload, now);
    expect(result).toBeNull();
  });

  it("returns null when sandboxCreatedAt undefined", () => {
    const now = 1000;
    const payload = { ...basePayload };
    const result = reason.evaluate(payload, now);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FileActivityReason
// ---------------------------------------------------------------------------
describe("FileActivityReason", () => {
  const reason = new FileActivityReason(30_000); // 30s

  it("returns reason when file activity is recent", () => {
    const now = 10_000;
    const payload = { ...basePayload, lastChangedAt: 5000 };
    const result = reason.evaluate(payload, now);
    expect(result).not.toBeNull();
    expect(result).toContain("active");
  });

  it("returns null when idle exceeds activeDuration", () => {
    const now = 100_000;
    const payload = { ...basePayload, lastChangedAt: 1000 };
    const result = reason.evaluate(payload, now);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CronScheduleReason
// ---------------------------------------------------------------------------
describe("CronScheduleReason", () => {
  const reason = new CronScheduleReason(300_000); // 5 min window

  it("returns reason when cron job is within keepAliveWindow", () => {
    const now = Date.now();
    const cronJobs = [
      {
        id: "1",
        schedule: "* * * * *",
        command: "run",
        nextRun: new Date(now + 60_000).toISOString(),
      },
    ];
    const result = reason.evaluate(basePayload, now, cronJobs);
    expect(result).not.toBeNull();
    expect(result).toBe("cron due soon");
  });

  it("returns null when next cron job is beyond window", () => {
    const now = Date.now();
    const cronJobs = [
      {
        id: "1",
        schedule: "* * * * *",
        command: "run",
        nextRun: new Date(now + 600_000).toISOString(),
      },
    ];
    const result = reason.evaluate(basePayload, now, cronJobs);
    expect(result).toBeNull();
  });

  it("filters NaN dates from cron jobs", () => {
    const now = Date.now();
    const cronJobs = [{ id: "1", schedule: "* * * * *", command: "run", nextRun: "not-a-date" }];
    const result = reason.evaluate(basePayload, now, cronJobs);
    expect(result).toBeNull();
  });

  it("returns null when no future jobs exist", () => {
    const now = Date.now();
    const cronJobs = [
      {
        id: "1",
        schedule: "* * * * *",
        command: "run",
        nextRun: new Date(now - 60_000).toISOString(),
      },
    ];
    const result = reason.evaluate(basePayload, now, cronJobs);
    expect(result).toBeNull();
  });

  it("picks closest cron job when multiple are within window", () => {
    const now = Date.now();
    const cronJobs = [
      {
        id: "1",
        schedule: "0 * * * *",
        command: "run hourly",
        nextRun: new Date(now + 240_000).toISOString(),
      },
      {
        id: "2",
        schedule: "*/2 * * * *",
        command: "run often",
        nextRun: new Date(now + 60_000).toISOString(),
      },
      {
        id: "3",
        schedule: "0 0 * * *",
        command: "run daily",
        nextRun: new Date(now + 400_000).toISOString(),
      },
    ];
    const result = reason.evaluate(basePayload, now, cronJobs);
    expect(result).toBe("cron due soon");
  });

  it("picks closest future job ignoring past jobs", () => {
    const now = Date.now();
    const cronJobs = [
      {
        id: "1",
        schedule: "* * * * *",
        command: "run",
        nextRun: new Date(now - 30_000).toISOString(),
      },
      {
        id: "2",
        schedule: "* * * * *",
        command: "run",
        nextRun: new Date(now + 120_000).toISOString(),
      },
      {
        id: "3",
        schedule: "* * * * *",
        command: "run",
        nextRun: new Date(now + 60_000).toISOString(),
      },
    ];
    const result = reason.evaluate(basePayload, now, cronJobs);
    expect(result).toBe("cron due soon");
  });

  it("returns null when closest future job is beyond window", () => {
    const now = Date.now();
    const cronJobs = [
      {
        id: "1",
        schedule: "* * * * *",
        command: "run",
        nextRun: new Date(now - 30_000).toISOString(),
      },
      {
        id: "2",
        schedule: "* * * * *",
        command: "run",
        nextRun: new Date(now + 400_000).toISOString(),
      },
      {
        id: "3",
        schedule: "* * * * *",
        command: "run",
        nextRun: new Date(now + 600_000).toISOString(),
      },
    ];
    const result = reason.evaluate(basePayload, now, cronJobs);
    expect(result).toBeNull();
  });
});

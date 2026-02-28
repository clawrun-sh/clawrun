import { describe, it, expect } from "vitest";
import {
  HOUSEKEEPING_FILES,
  DAEMON_PORT,
  DAEMON_HOST,
  DAEMON_PROCESS_PATTERN,
} from "./constants.js";

describe("DAEMON_PORT", () => {
  it("is 3000", () => {
    expect(DAEMON_PORT).toBe(3000);
  });
});

describe("DAEMON_HOST", () => {
  it("is 0.0.0.0", () => {
    expect(DAEMON_HOST).toBe("0.0.0.0");
  });
});

describe("DAEMON_PROCESS_PATTERN", () => {
  it("matches the zeroclaw daemon process name", () => {
    expect(DAEMON_PROCESS_PATTERN).toBe("zeroclaw daemon");
  });
});

describe("HOUSEKEEPING_FILES", () => {
  it("contains daemon_state.json", () => {
    expect(HOUSEKEEPING_FILES).toContain("daemon_state.json");
  });

  it("contains jobs.db", () => {
    expect(HOUSEKEEPING_FILES).toContain("jobs.db");
  });

  it("contains jobs.db-wal", () => {
    expect(HOUSEKEEPING_FILES).toContain("jobs.db-wal");
  });

  it("contains jobs.db-shm", () => {
    expect(HOUSEKEEPING_FILES).toContain("jobs.db-shm");
  });

  it("contains jobs.db-journal", () => {
    expect(HOUSEKEEPING_FILES).toContain("jobs.db-journal");
  });

  it("has exactly 5 entries", () => {
    expect(HOUSEKEEPING_FILES).toHaveLength(5);
  });
});

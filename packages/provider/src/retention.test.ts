import { describe, it, expect } from "vitest";
import { CountBasedRetention } from "./retention.js";

describe("CountBasedRetention", () => {
  const policy = new CountBasedRetention(2);

  it("keeps newest N snapshots, marks rest for deletion", () => {
    const snapshots = [
      { id: "a", createdAt: 100 },
      { id: "b", createdAt: 200 },
      { id: "c", createdAt: 300 },
      { id: "d", createdAt: 400 },
    ];
    const deletions = policy.selectForDeletion(snapshots);
    expect(deletions.length).toBe(2);
    expect(deletions).toContain("a");
    expect(deletions).toContain("b");
  });

  it("empty list returns empty", () => {
    const deletions = policy.selectForDeletion([]);
    expect(deletions.length).toBe(0);
  });

  it("list smaller than keepCount returns empty", () => {
    const snapshots = [{ id: "a", createdAt: 100 }];
    const deletions = policy.selectForDeletion(snapshots);
    expect(deletions.length).toBe(0);
  });

  it("sorts by creation time (newest kept)", () => {
    const snapshots = [
      { id: "old", createdAt: 10 },
      { id: "new", createdAt: 1000 },
      { id: "mid", createdAt: 500 },
    ];
    const deletions = policy.selectForDeletion(snapshots);
    // keepCount=2 → keep "new" and "mid", delete "old"
    expect(deletions).toEqual(["old"]);
  });
});

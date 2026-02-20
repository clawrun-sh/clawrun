import type { SnapshotInfo } from "./types";

export interface SnapshotRetentionPolicy {
  /** Given all snapshots, return the IDs that should be deleted. */
  selectForDeletion(snapshots: SnapshotInfo[]): string[];
}

export class CountBasedRetention implements SnapshotRetentionPolicy {
  constructor(private readonly keepCount: number = 3) {}

  selectForDeletion(snapshots: SnapshotInfo[]): string[] {
    const sorted = [...snapshots].sort((a, b) => b.createdAt - a.createdAt);
    return sorted.slice(this.keepCount).map((s) => s.id);
  }
}

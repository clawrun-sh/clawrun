import type { SnapshotInfo, SnapshotId } from "./types.js";

export interface SnapshotRetentionPolicy {
  /** Given all snapshots, return the IDs that should be deleted. */
  selectForDeletion(snapshots: SnapshotInfo[]): SnapshotId[];
}

export class CountBasedRetention implements SnapshotRetentionPolicy {
  constructor(private readonly keepCount: number = 3) {}

  selectForDeletion(snapshots: SnapshotInfo[]): SnapshotId[] {
    const sorted = [...snapshots].sort((a, b) => b.createdAt - a.createdAt);
    return sorted.slice(this.keepCount).map((s) => s.id);
  }
}

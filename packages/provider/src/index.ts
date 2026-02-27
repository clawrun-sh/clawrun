export type {
  RunCommandOptions,
  CommandResult,
  ManagedSandbox,
  SnapshotRef,
  SandboxInfo,
  SnapshotInfo,
  CreateSandboxOptions,
  SandboxProvider,
  NetworkPolicy,
} from "./types.js";

export type { SnapshotRetentionPolicy } from "./retention.js";
export { CountBasedRetention } from "./retention.js";

export { getProvider } from "./registry.js";

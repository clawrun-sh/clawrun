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
  ProviderOptions,
} from "./types.js";

export type { SnapshotRetentionPolicy } from "./retention.js";
export { CountBasedRetention } from "./retention.js";

export { getProvider, registerProviderFactory } from "./registry.js";

export { PROVIDER_IDS, sandboxId, snapshotId } from "./types.js";
export type {
  ProviderId,
  SandboxId,
  SnapshotId,
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

// --- Platform provider ---

export type {
  PlatformTier,
  PlatformLimits,
  ProjectHandle,
  StateStoreEntry,
  StateStoreResult,
  LogsOptions,
  ProgressEvent,
  ProgressCallback,
  PlatformStep,
  PlatformProvider,
} from "./platform-types.js";

export { getPlatformProvider, registerPlatformFactory } from "./registry.js";

// --- Public API ---
export { ClawRunClient } from "./client.js";
export { ClawRunInstance } from "./instance.js";

// --- Error classes ---
export {
  ClawRunError,
  ApiError,
  NetworkError,
  DeployError,
  ChatStreamError,
  ProviderNotConfiguredError,
} from "./errors.js";

// --- Types ---
export type {
  ClientOptions,
  InstanceApiConfig,
  InstanceProviderConfig,
  InstanceConfig,
  ProviderSetup,
  DeployStep,
  DeployOptions,
  DeployResult,
  StartResult,
  StopResult,
  RestartResult,
  HistoryMessage,
  HistoryResult,
  ChatOptions,
  ChatStream,
  SandboxEntry,
  ExecResult,
  ExecOptions,
  InviteResult,
  ClawRunConfig,
} from "./types.js";

// --- Agent type re-exports (so consumers don't need @clawrun/agent) ---
export type {
  ThreadInfo,
  CronJob,
  MemoryEntryInfo,
  AgentStatus,
  CostInfo,
  AgentConfig,
  RuntimeToolInfo,
  CliToolInfo,
  DiagResult,
  HealthResult,
  ToolsResult,
  DiagnosticsResult,
  ThreadsResult,
  ThreadResult,
  MemoriesResult,
  MemoryQuery,
  CreateMemoryInput,
  CronJobsResult,
  CreateCronJobInput,
} from "./types.js";

// --- AI SDK re-exports (so consumers don't need a direct `ai` dependency) ---
export type {
  UIMessage,
  UIMessagePart,
  UIMessageChunk,
  TextUIPart,
  ReasoningUIPart,
  DynamicToolUIPart,
} from "ai";
export { readUIMessageStream } from "ai";

// --- Deploy helpers (for CLI reuse) ---
export { deploy } from "./deploy.js";
export { deriveAllowedDomains, domainMatchesWildcard } from "./deploy.js";
export type { DerivedDomains } from "./deploy.js";

// --- Internal modules (for CLI reuse) ---
export {
  clawrunHome,
  instancesDir,
  instanceDir,
  instanceAgentDir,
  instanceDeployDir,
  createInstance,
  listInstances,
  getInstance,
  instanceExists,
  saveDeployedUrl,
  upgradeInstance,
  destroyInstance,
  copyMirroredFiles,
  isDevMode,
  copyServerApp,
  clawRunConfigSchema,
  buildConfig,
  toEnvVars,
  sanitizeConfig,
  readConfig,
  writeConfig,
  generateSecret,
} from "./instance/index.js";
export type { InstanceMetadata, InstanceStep, ClawRunConfigWithSecrets } from "./instance/index.js";

export {
  getPreset,
  listPresets,
  loadPresetFromDir,
  registerPreset,
  getWorkspaceFiles,
  presetSchema,
  PRESET_SCHEMA_URL,
} from "./presets/index.js";
export type { Preset } from "./presets/index.js";

export { getPlatformProvider, PROVIDER_IDS, sandboxId, snapshotId } from "@clawrun/provider";
export type {
  ProviderId,
  SandboxId,
  SnapshotId,
  SandboxStatus,
  LogsOptions,
  PlatformProvider,
  PlatformTier,
  PlatformLimits,
  PlatformStep,
  ProgressEvent,
  ProgressCallback,
  ProjectHandle,
  StateStoreEntry,
  StateStoreResult,
} from "@clawrun/provider";

// --- Low-level clients (for advanced usage) ---
export { ApiClient } from "./api-client.js";
export { SandboxClient } from "./sandbox.js";
export { createChatStream } from "./chat.js";

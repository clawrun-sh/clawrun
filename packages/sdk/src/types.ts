import type { ClawRunConfig } from "@clawrun/runtime";
import type { ProviderId, SandboxId, SandboxStatus } from "@clawrun/provider";
import type { UIMessage, UIMessageChunk } from "ai";

// Re-export so consumers don't need to depend on @clawrun/runtime
export type { ClawRunConfig };

// Re-export agent types so consumers don't need a direct @clawrun/agent dependency
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
  LogEntry,
  LogsResult,
  WorkspaceFile,
  WorkspaceListResult,
  WorkspaceFileResult,
} from "@clawrun/agent";

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface ClientOptions {
  /** Custom fetch implementation (defaults to globalThis.fetch). */
  fetch?: typeof fetch;
}

// ---------------------------------------------------------------------------
// Connect (remote instance)
// ---------------------------------------------------------------------------

export interface InstanceApiConfig {
  url: string;
  /** JWT secret for Bearer auth. When omitted, relies on browser session cookies. */
  jwtSecret?: string;
}

export interface InstanceProviderConfig {
  provider: ProviderId;
  providerOptions?: { projectDir?: string };
}

export interface InstanceConfig {
  api: InstanceApiConfig;
  sandbox?: InstanceProviderConfig;
}

// ---------------------------------------------------------------------------
// Deploy
// ---------------------------------------------------------------------------

export interface ProviderSetup {
  provider: string;
  apiKey: string;
  model: string;
  apiUrl?: string;
}

/** Typed deploy orchestration steps. Consumers can exhaustively match on these. */
export type DeployStep =
  | "resolve-preset"
  | "init-platform"
  | "check-prerequisites"
  | "detect-tier"
  | "create-agent"
  | "seed-workspace"
  | "generate-secrets"
  | "create-project"
  | "provision-state"
  | "build-config"
  | "create-instance"
  | "configure-platform"
  | "persist-env"
  | "deploy"
  | "start-sandbox"
  | "complete"
  | "cleanup";

export interface DeployOptions {
  /** Preset ID (e.g. "starter") */
  preset: string;
  agent: {
    provider: ProviderSetup;
    channels?: Record<string, Record<string, string>>;
    tools?: string[];
  };
  /** Instance name — auto-generated if omitted. */
  name?: string;
  /** Network policy — defaults to "allow-all". */
  networkPolicy?: ClawRunConfig["sandbox"]["networkPolicy"];
  /** Path to custom workspace template directory. */
  customWorkspaceDir?: string;
  /** Reuse an existing state store by ID. */
  stateStore?: { id: string };
  /** Progress callback — receives typed deploy events for each orchestration step. */
  onProgress?: import("@clawrun/provider").ProgressCallback<DeployStep>;
}

export interface DeployResult {
  name: string;
  url: string;
  config: ClawRunConfig;
  /** A live ClawRunInstance connected to the deployed app. */
  instance: import("./instance.js").ClawRunInstance;
}

// ---------------------------------------------------------------------------
// Lifecycle results (discriminated unions)
// ---------------------------------------------------------------------------

/**
 * Result of starting/waking a sandbox.
 * Discriminated on `status` — check `result.status` to narrow field access.
 */
export type StartResult =
  | { status: "running"; sandboxId?: SandboxId }
  | { status: "failed"; error: string };

/**
 * Result of stopping a sandbox (snapshot + stop).
 * Discriminated on `status` — check `result.status` to narrow field access.
 */
export type StopResult =
  | { status: "stopped"; sandboxId?: SandboxId }
  | { status: "failed"; error: string };

/**
 * Result of force-restarting a sandbox.
 * Discriminated on `status` — check `result.status` to narrow field access.
 */
export type RestartResult =
  | { status: "running"; sandboxId?: SandboxId }
  | { status: "failed"; error: string };

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export interface HistoryMessage {
  role: string;
  content: string;
}

export interface HistoryResult {
  messages: HistoryMessage[];
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export interface ChatOptions {
  id?: string;
  signal?: AbortSignal;
}

export interface ChatStream {
  /** Iterate raw stream events (AI SDK UIMessageChunk). */
  [Symbol.asyncIterator](): AsyncIterableIterator<UIMessageChunk>;
  /** Consume the full stream and return the accumulated UIMessage. Throws ChatStreamError on stream error. */
  result(): Promise<UIMessage>;
}

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

export interface SandboxEntry {
  id: SandboxId;
  status: SandboxStatus;
  createdAt: number;
  memory: number;
  vcpus: number;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  env?: Record<string, string>;
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Invite
// ---------------------------------------------------------------------------

export interface InviteResult {
  token: string;
  url: string;
}

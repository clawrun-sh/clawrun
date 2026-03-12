import type {
  ProviderInfo,
  ProviderSetup,
  ChannelInfo,
  CuratedModel,
  AgentSetupData,
} from "./schemas.js";
import type { Tool } from "./tools.js";
import type { UIMessage, UIMessageStreamWriter } from "ai";

export type {
  ProviderInfo,
  ProviderSetup,
  ChannelSetupField,
  ChannelInfo,
  CuratedModel,
  CostSetupData,
  AgentSetupData,
} from "./schemas.js";

export interface CommandResult {
  exitCode: number;
  stdout(): Promise<string>;
  stderr(): Promise<string>;
}

export interface SandboxHandle {
  runCommand(cmd: string, args?: string[]): Promise<CommandResult>;
  runCommand(opts: {
    cmd: string;
    args?: string[];
    env?: Record<string, string>;
    signal?: AbortSignal;
    detached?: boolean;
  }): Promise<CommandResult>;
  writeFiles(files: Array<{ path: string; content: Buffer }>): Promise<void>;
  readFile(path: string): Promise<Buffer | null>;
  domain?(port: number): string;
}

/**
 * Tool call data from a batch (non-streaming) agent response.
 *
 * Used only by `sendMessage()`. The streaming path (`streamMessage()`) writes
 * AI SDK events directly (tool-input-available, tool-output-available) and
 * does not use this type.
 */
export interface ToolCallInfo {
  name: string;
  arguments: Record<string, unknown>;
  output?: string;
}

/**
 * Batch response from `Agent.sendMessage()`.
 *
 * For streaming, agents implement `streamMessage()` which writes AI SDK
 * UIMessageStreamWriter events directly — no AgentResponse involved.
 *
 * Consumers: runner.ts (ephemeral sandbox), chat handler batch fallback,
 * CLI one-shot mode.
 */
export interface AgentResponse {
  success: boolean;
  message: string;
  error?: string;
  toolCalls?: ToolCallInfo[];
}

/** Summary of a conversation thread, used by the thread listing API. */
export interface ThreadInfo {
  id: string;
  channel: string;
  preview: string;
  messageCount: number;
  lastActivity: string;
}

// ---------------------------------------------------------------------------
// Dashboard API types — agent-agnostic, returned by optional Agent methods
// ---------------------------------------------------------------------------

export interface AgentStatus {
  provider?: string;
  model?: string;
  uptime?: number;
  memoryBackend?: string;
  channels?: string[];
  health?: { name: string; status: string; restarts?: number }[];
}

export interface AgentConfig {
  format: "toml" | "json" | "yaml" | "text";
  content: string;
}

export interface RuntimeToolInfo {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface CliToolInfo {
  name: string;
  path?: string;
  version?: string;
  category?: string;
}

export interface CronJob {
  id: string;
  name?: string;
  schedule?: string;
  command: string;
  nextRun?: string;
  lastRun?: string;
  lastStatus?: string;
  enabled?: boolean;
}

export interface MemoryEntryInfo {
  key: string;
  content: string;
  category?: string;
  timestamp?: string;
  source?: {
    type: string; // "cron" | "user" | "webhook" | ...
    id?: string; // e.g. cron job ID
    name?: string; // e.g. cron job name
  };
}

export interface CostInfo {
  sessionCost?: number;
  dailyCost?: number;
  monthlyCost?: number;
  totalTokens?: number;
  requestCount?: number;
  byModel?: { model: string; cost: number; tokens: number; requests: number; share: number }[];
  /** Daily spending limit in USD (from agent config). */
  dailyLimitUsd?: number;
  /** Monthly spending limit in USD (from agent config). */
  monthlyLimitUsd?: number;
}

export interface DiagResult {
  category: string;
  message: string;
  severity: "ok" | "warning" | "error";
}

// ---------------------------------------------------------------------------
// API response / input types — shared by SDK and server UI components
// ---------------------------------------------------------------------------

export interface HealthResult {
  status: string;
  agent: string;
  sandbox: { running: boolean; status?: string };
}

export interface ToolsResult {
  tools: RuntimeToolInfo[];
  cliTools: CliToolInfo[];
}

export interface DiagnosticsResult {
  results: DiagResult[];
}

export interface ThreadsResult {
  threads: ThreadInfo[];
}

export interface ThreadResult {
  messages: UIMessage[];
}

export interface MemoriesResult {
  entries: MemoryEntryInfo[];
}

export interface MemoryQuery {
  query?: string;
  category?: string;
}

export interface CreateMemoryInput {
  key: string;
  content: string;
  category?: string;
}

export interface CronJobsResult {
  jobs: CronJob[];
}

export interface LogEntry {
  level: number;
  time: number;
  tag?: string;
  msg: string;
}

export interface LogsResult {
  entries: LogEntry[];
}

export interface WorkspaceFile {
  name: string;
  path: string;
}

export interface WorkspaceListResult {
  files: WorkspaceFile[];
}

export interface WorkspaceFileResult {
  name: string;
  content: string;
}

export interface CreateCronJobInput {
  name?: string;
  schedule: string;
  command: string;
}

export interface DaemonCommand {
  cmd: string;
  args: string[];
  env: Record<string, string>;
}

export interface MonitorConfig {
  dir: string;
  ignoreFiles: string[];
}

export interface ProvisionOpts {
  localAgentDir: string;
  secretKey: string;
  fromSnapshot?: boolean;
}

export interface Agent {
  readonly id: string;
  readonly name: string;

  /** Key in agent's parsed config that holds per-channel configuration. */
  readonly channelsConfigKey: string;

  /** Port the agent daemon listens on inside the sandbox. */
  readonly daemonPort: number;

  provision(sandbox: SandboxHandle, root: string, opts: ProvisionOpts): Promise<void>;

  /**
   * Return tools enabled in the agent config.
   * Used to build sidecar tool install config (runs inside the sandbox).
   */
  getEnabledTools(agentDir: string): Tool[];

  /**
   * Return ALL tools this agent supports, regardless of current config.
   * Used by the CLI to present a tool selection step during deploy.
   */
  getAvailableTools(): Tool[];

  sendMessage(
    sandbox: SandboxHandle,
    root: string,
    message: string,
    opts?: {
      env?: Record<string, string>;
      signal?: AbortSignal;
      threadId?: string;
    },
  ): Promise<AgentResponse>;

  /**
   * Stream a message exchange to the given AI SDK writer.
   *
   * The agent translates its own protocol (WS, CLI, etc.) into AI SDK
   * UIMessageStream events. Agents that don't support streaming can omit
   * this method — the handler will fall back to sendMessage().
   */
  streamMessage(
    sandbox: SandboxHandle,
    root: string,
    message: string,
    writer: UIMessageStreamWriter,
    opts?: { signal?: AbortSignal; threadId?: string },
  ): Promise<void>;

  /** List all conversation threads across all channels. */
  listThreads(
    sandbox: SandboxHandle,
    root: string,
    opts?: { signal?: AbortSignal },
  ): Promise<ThreadInfo[]>;

  /** Get messages for a specific conversation thread as AI SDK UIMessages. */
  getThread(
    sandbox: SandboxHandle,
    root: string,
    threadId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<UIMessage[]>;

  getDaemonCommand(
    root: string,
    opts?: {
      port?: number;
      host?: string;
      env?: Record<string, string>;
    },
  ): DaemonCommand;

  listCronJobs(
    sandbox: SandboxHandle,
    root: string,
    opts?: { signal?: AbortSignal },
  ): Promise<CronJob[]>;

  getMonitorConfig(root: string): MonitorConfig;

  /** Providers this agent supports, grouped by tier. */
  getProviders(): ProviderInfo[];

  /** Default model for a given provider name. */
  getDefaultModel(provider: string): string;

  /** Curated static model list for a provider. Used as fallback when live fetch fails. */
  getCuratedModels(provider: string): CuratedModel[];

  /** API endpoint for fetching live model lists. Null if not supported. */
  getModelsFetchEndpoint(
    provider: string,
    apiUrl?: string,
  ): {
    url: string;
    authHeader: (key: string) => Record<string, string>;
  } | null;

  /** ALL channels this agent supports, with complete setup field declarations. */
  getSupportedChannels(): ChannelInfo[];

  /** Write agent-specific config from normalized setup data. */
  writeSetupConfig(agentDir: string, data: AgentSetupData): void;

  /** Read existing setup from agent config dir. Null if no config. */
  readSetup(agentDir: string): {
    provider?: Partial<ProviderSetup>;
    channels?: Record<string, Record<string, string>>;
    cost?: {
      enabled?: boolean;
      inputPerMillion?: number;
      outputPerMillion?: number;
      dailyLimitUsd?: number;
      monthlyLimitUsd?: number;
    };
  } | null;

  /** Return tools enabled in the agent config (for install-time domain checks). */
  getToolDomains(agentDir: string): Tool[];

  /** Files managed locally that should not be overwritten by pull. */
  getLocalOwnedFiles(): string[];

  /** Glob patterns (relative to agent dir) to bundle into the deployed app and mirror to .deploy/. */
  getBundleFiles(): string[];

  /** npm dependencies the deployed instance needs for this agent. */
  getInstallDependencies(): Record<string, string>;

  /** Subdirectory (relative to agent config dir) for seeded workspace files. Null to skip seeding. */
  getSeedDirectory(): string | null;

  /** Glob patterns (relative to deploy dir) for binary files to bundle. */
  getBinaryBundlePaths(): string[];

  // --- Dashboard API methods ---

  getStatus(
    sandbox: SandboxHandle,
    root: string,
    opts?: { signal?: AbortSignal },
  ): Promise<AgentStatus>;

  getConfig(
    sandbox: SandboxHandle,
    root: string,
    opts?: { signal?: AbortSignal },
  ): Promise<AgentConfig>;

  listTools(
    sandbox: SandboxHandle,
    root: string,
    opts?: { signal?: AbortSignal },
  ): Promise<ToolsResult>;

  createCronJob(
    sandbox: SandboxHandle,
    root: string,
    job: CreateCronJobInput,
    opts?: { signal?: AbortSignal },
  ): Promise<CronJob>;

  deleteCronJob(
    sandbox: SandboxHandle,
    root: string,
    id: string,
    opts?: { signal?: AbortSignal },
  ): Promise<void>;

  listMemories(
    sandbox: SandboxHandle,
    root: string,
    query?: MemoryQuery,
    opts?: { signal?: AbortSignal },
  ): Promise<MemoryEntryInfo[]>;

  createMemory(
    sandbox: SandboxHandle,
    root: string,
    entry: CreateMemoryInput,
    opts?: { signal?: AbortSignal },
  ): Promise<void>;

  deleteMemory(
    sandbox: SandboxHandle,
    root: string,
    key: string,
    opts?: { signal?: AbortSignal },
  ): Promise<void>;

  getCostInfo(
    sandbox: SandboxHandle,
    root: string,
    opts?: { signal?: AbortSignal },
  ): Promise<CostInfo>;

  runDiagnostics(
    sandbox: SandboxHandle,
    root: string,
    opts?: { signal?: AbortSignal },
  ): Promise<DiagResult[]>;
}

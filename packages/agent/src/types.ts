import type {
  ProviderInfo,
  ProviderSetup,
  ChannelInfo,
  CuratedModel,
  AgentSetupData,
} from "./schemas.js";
import type { Tool } from "./tools.js";

export type {
  ProviderInfo,
  ProviderSetup,
  ChannelSetupField,
  ChannelInfo,
  CuratedModel,
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

export interface CronEntry {
  name?: string;
  schedule?: string;
  nextRunAt: string;
}

export interface CronInfo {
  jobs: CronEntry[];
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
      sessionId?: string;
    },
  ): Promise<AgentResponse>;

  /**
   * Stream a message exchange to the given writer using AI SDK stream events.
   *
   * The agent acts as an adapter: it translates its own protocol (WS, CLI, etc.)
   * into AI SDK UIMessageStream events (text-start, text-delta, text-end,
   * tool-input-available, tool-output-available, error).
   *
   * The writer is structurally compatible with the AI SDK UIMessageStreamWriter.
   * Agents that don't support streaming can omit this method — the handler will
   * fall back to sendMessage().
   */
  streamMessage?(
    sandbox: SandboxHandle,
    root: string,
    message: string,
    writer: { write(part: unknown): void },
    opts?: { signal?: AbortSignal; sessionId?: string },
  ): Promise<void>;

  /** Fetch conversation history for a session from the agent daemon. */
  fetchHistory?(
    sandbox: SandboxHandle,
    root: string,
    sessionId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<Array<{ role: string; content: string }>>;

  getDaemonCommand(
    root: string,
    opts?: {
      port?: number;
      host?: string;
      env?: Record<string, string>;
    },
  ): DaemonCommand;

  getCrons(sandbox: SandboxHandle, root: string): Promise<CronInfo>;

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
}

import { signInviteToken } from "@clawrun/auth";
import { getProvider } from "@clawrun/provider";
import type { UIMessage } from "ai";
import { ApiClient } from "./api-client.js";
import { createChatStream } from "./chat.js";
import { SandboxClient } from "./sandbox.js";
import { ProviderNotConfiguredError } from "./errors.js";
import type {
  InstanceConfig,
  ChatOptions,
  ChatStream,
  StartResult,
  StopResult,
  RestartResult,
  HistoryResult,
  InviteResult,
  ClientOptions,
} from "./types.js";
import type {
  AgentStatus,
  CostInfo,
  AgentConfig,
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
  CronJob,
  LogsResult,
  WorkspaceListResult,
  WorkspaceFileResult,
} from "@clawrun/agent";

/**
 * Represents a connection to a deployed ClawRun instance.
 * Provides methods for lifecycle management, chat, and sandbox operations.
 */
export class ClawRunInstance {
  private readonly api: ApiClient;
  private readonly jwtSecret: string | undefined;
  private readonly config: InstanceConfig;
  private _sandbox: SandboxClient | undefined;

  constructor(config: InstanceConfig, options?: ClientOptions) {
    this.config = config;
    this.jwtSecret = config.api.jwtSecret;
    this.api = new ApiClient(config.api.url, this.jwtSecret, { fetch: options?.fetch });
  }

  /**
   * Create an instance for use in the browser (cookie-based auth).
   * Uses session cookies instead of JWT Bearer tokens.
   * @param baseUrl Base URL of the deployed instance. Defaults to "" (same-origin).
   */
  static browser(baseUrl: string = ""): ClawRunInstance {
    return new ClawRunInstance({ api: { url: baseUrl } });
  }

  /** The base URL of the deployed instance. */
  get webUrl(): string {
    return this.api.url;
  }

  /**
   * Lazily initialized SandboxClient for provider-level operations.
   * Throws ProviderNotConfiguredError if no provider config was given.
   */
  get sandbox(): SandboxClient {
    if (!this._sandbox) {
      if (!this.config.sandbox) {
        throw new ProviderNotConfiguredError();
      }
      const provider = getProvider(
        this.config.sandbox.provider,
        this.config.sandbox.providerOptions,
      );
      this._sandbox = new SandboxClient(provider);
    }
    return this._sandbox;
  }

  // --- Lifecycle ---

  /** Start or wake the sandbox. */
  async start(signal?: AbortSignal): Promise<StartResult> {
    return this.api.post<StartResult>("/api/v1/sandbox/start", undefined, signal);
  }

  /** Snapshot and stop the sandbox. */
  async stop(signal?: AbortSignal): Promise<StopResult> {
    return this.api.post<StopResult>("/api/v1/sandbox/stop", undefined, signal);
  }

  /** Force restart the sandbox. */
  async restart(signal?: AbortSignal): Promise<RestartResult> {
    return this.api.post<RestartResult>("/api/v1/sandbox/restart", undefined, signal);
  }

  /** Get health and sandbox status. */
  async health(signal?: AbortSignal): Promise<HealthResult> {
    return this.api.get<HealthResult>("/api/v1/health", signal);
  }

  // --- Chat ---

  /**
   * Send a message and get back a ChatStream.
   * The stream is lazy — the HTTP request is not made until iteration begins.
   *
   * ```ts
   * const stream = instance.chat("Hello");
   * for await (const event of stream) {
   *   if (event.type === "text-delta") process.stdout.write(event.delta);
   * }
   * ```
   */
  chat(message: string, options?: ChatOptions): ChatStream {
    return createChatStream(this.api, message, options);
  }

  /**
   * Convenience: send a message and wait for the full response.
   * Equivalent to `chat(msg, opts).result()`.
   * Throws ChatStreamError if the stream contains an error event.
   */
  async sendMessage(message: string, options?: ChatOptions): Promise<UIMessage> {
    return this.chat(message, options).result();
  }

  /**
   * Get conversation history for a session.
   */
  async getHistory(threadId: string, signal?: AbortSignal): Promise<HistoryResult> {
    return this.api.get<HistoryResult>(
      `/api/v1/history?threadId=${encodeURIComponent(threadId)}`,
      signal,
    );
  }

  // --- Agent queries ---

  /** Get agent status (provider, model, uptime, channels, health). */
  async getStatus(signal?: AbortSignal): Promise<AgentStatus> {
    return this.api.get<AgentStatus>("/api/v1/status", signal);
  }

  /** Get cost and token usage information. */
  async getCost(signal?: AbortSignal): Promise<CostInfo> {
    return this.api.get<CostInfo>("/api/v1/cost", signal);
  }

  /** Get the agent configuration file content. */
  async getConfig(signal?: AbortSignal): Promise<AgentConfig> {
    return this.api.get<AgentConfig>("/api/v1/config", signal);
  }

  /** List available runtime and CLI tools. */
  async listTools(signal?: AbortSignal): Promise<ToolsResult> {
    return this.api.get<ToolsResult>("/api/v1/tools", signal);
  }

  /** Run agent diagnostics. */
  async runDiagnostics(signal?: AbortSignal): Promise<DiagnosticsResult> {
    return this.api.get<DiagnosticsResult>("/api/v1/diagnostics", signal);
  }

  // --- Threads ---

  /** List all conversation threads. */
  async listThreads(signal?: AbortSignal): Promise<ThreadsResult> {
    return this.api.get<ThreadsResult>("/api/v1/threads", signal);
  }

  /** Get messages for a specific thread. */
  async getThread(threadId: string, signal?: AbortSignal): Promise<ThreadResult> {
    return this.api.get<ThreadResult>(`/api/v1/threads/${encodeURIComponent(threadId)}`, signal);
  }

  // --- Memory CRUD ---

  /** List memory entries, optionally filtered by query and/or category. */
  async listMemories(options?: MemoryQuery, signal?: AbortSignal): Promise<MemoriesResult> {
    const params = new URLSearchParams();
    if (options?.query) params.set("query", options.query);
    if (options?.category) params.set("category", options.category);
    const qs = params.toString();
    return this.api.get<MemoriesResult>(`/api/v1/memory${qs ? `?${qs}` : ""}`, signal);
  }

  /** Create a new memory entry. */
  async createMemory(entry: CreateMemoryInput, signal?: AbortSignal): Promise<void> {
    await this.api.post("/api/v1/memory", entry, signal);
  }

  /** Delete a memory entry by key. */
  async deleteMemory(key: string, signal?: AbortSignal): Promise<void> {
    await this.api.delete(`/api/v1/memory/${encodeURIComponent(key)}`, signal);
  }

  // --- Cron CRUD ---

  /** List all cron jobs. */
  async listCronJobs(signal?: AbortSignal): Promise<CronJobsResult> {
    return this.api.get<CronJobsResult>("/api/v1/cron", signal);
  }

  /** Create a new cron job. */
  async createCronJob(job: CreateCronJobInput, signal?: AbortSignal): Promise<CronJob> {
    return this.api.post<CronJob>("/api/v1/cron", job, signal);
  }

  /** Delete a cron job by ID. */
  async deleteCronJob(id: string, signal?: AbortSignal): Promise<void> {
    await this.api.delete(`/api/v1/cron/${encodeURIComponent(id)}`, signal);
  }

  // --- Logs ---

  /** Read sidecar log entries from the sandbox. */
  async readLogs(options?: { limit?: number }, signal?: AbortSignal): Promise<LogsResult> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", String(options.limit));
    const qs = params.toString();
    return this.api.get<LogsResult>(`/api/v1/logs${qs ? `?${qs}` : ""}`, signal);
  }

  // --- Workspace ---

  /** List .md files in the agent workspace directory. */
  async listWorkspaceFiles(signal?: AbortSignal): Promise<WorkspaceListResult> {
    return this.api.get<WorkspaceListResult>("/api/v1/workspace", signal);
  }

  /** Read a workspace file by name. */
  async readWorkspaceFile(name: string, signal?: AbortSignal): Promise<WorkspaceFileResult> {
    return this.api.get<WorkspaceFileResult>(
      `/api/v1/workspace/${encodeURIComponent(name)}`,
      signal,
    );
  }

  // --- Invite ---

  /**
   * Create an invite token and URL.
   * @param ttl Token TTL in seconds (default: 7 days).
   */
  async createInvite(ttl: number = 7 * 24 * 60 * 60): Promise<InviteResult> {
    if (!this.jwtSecret) {
      throw new Error("createInvite requires jwtSecret (not available in cookie mode)");
    }
    const token = await signInviteToken(this.jwtSecret, `${ttl}s`);
    const url = `${this.webUrl}/auth/accept?token=${token}`;
    return { token, url };
  }

  // --- Destroy ---

  /**
   * Stop all sandboxes and delete all snapshots for this instance.
   * Requires sandbox provider to be configured.
   */
  async destroySandboxes(): Promise<void> {
    const sandboxes = await this.sandbox.list();
    const runningIds = sandboxes.filter((s) => s.status === "running").map((s) => s.id);
    if (runningIds.length > 0) {
      await this.sandbox.stop(...runningIds);
    }

    const snapshots = await this.sandbox.listSnapshots();
    if (snapshots.length > 0) {
      await this.sandbox.deleteSnapshots(...snapshots);
    }
  }
}

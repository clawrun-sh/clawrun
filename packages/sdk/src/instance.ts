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
  HealthResult,
  HistoryResult,
  InviteResult,
  ClientOptions,
} from "./types.js";

/**
 * Represents a connection to a deployed ClawRun instance.
 * Provides methods for lifecycle management, chat, and sandbox operations.
 */
export class ClawRunInstance {
  private readonly api: ApiClient;
  private readonly jwtSecret: string;
  private readonly config: InstanceConfig;
  private _sandbox: SandboxClient | undefined;

  constructor(config: InstanceConfig, options?: ClientOptions) {
    this.config = config;
    this.jwtSecret = config.api.jwtSecret;
    this.api = new ApiClient(config.api.url, this.jwtSecret, { fetch: options?.fetch });
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

  // --- Invite ---

  /**
   * Create an invite token and URL.
   * @param ttl Token TTL in seconds (default: 7 days).
   */
  async createInvite(ttl: number = 7 * 24 * 60 * 60): Promise<InviteResult> {
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

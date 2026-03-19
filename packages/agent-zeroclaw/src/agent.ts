import {
  provision as zeroclawProvision,
  buildDaemonCommand,
  HOUSEKEEPING_FILES,
  DAEMON_PORT,
} from "zeroclaw";
import type { ZeroClawConfig } from "zeroclaw";
import * as TOML from "@iarna/toml";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type {
  Agent,
  SandboxHandle,
  AgentResponse,
  DaemonCommand,
  MonitorConfig,
  ProvisionOpts,
  ProviderInfo,
  ProviderSetup,
  CuratedModel,
  ChannelInfo,
  AgentSetupData,
  ThreadInfo,
  UIMessageStreamWriter,
  AgentStatus,
  AgentConfig,
  CronJob,
  MemoryEntryInfo,
  CostInfo,
  DiagResult,
  ToolsResult,
  CreateCronJobInput,
  MemoryQuery,
  CreateMemoryInput,
} from "@clawrun/agent";
import type { UIMessage } from "ai";
import type { Tool } from "@clawrun/agent";
import { AgentBrowserTool, GhCliTool, FindSkillsTool } from "@clawrun/agent";
import { createLogger } from "@clawrun/logger";

const log = createLogger("agent:zeroclaw");

import {
  sendMessageViaCli,
  sendMessageViaDaemon,
  streamMessageViaDaemon,
  listThreadsViaDaemon,
  getThreadViaDaemon,
  fetchAgentStatus,
  fetchAgentConfig,
  fetchRuntimeTools,
  fetchCronJobs,
  postCronJob,
  deleteCronJobVia,
  fetchMemories,
  postMemory,
  deleteMemoryEntry,
  fetchCostInfo,
  fetchDiagnostics,
} from "./messaging.js";
import { writeSetupConfig, readSetup } from "./config.js";
import {
  PROVIDERS,
  getDefaultModel,
  getCuratedModels,
  getModelsFetchEndpoint,
  CHANNELS,
} from "./catalog.js";

export class ZeroclawAgent implements Agent {
  readonly id = "zeroclaw";
  readonly name = "ZeroClaw";
  readonly channelsConfigKey = "channels_config";
  readonly daemonPort = DAEMON_PORT;

  private env(root: string): Record<string, string> {
    return {
      ZEROCLAW_WORKSPACE: `${root}/agent`,
      ZEROCLAW_CONFIG_DIR: `${root}/agent`,
    };
  }

  async provision(sandbox: SandboxHandle, root: string, opts: ProvisionOpts): Promise<void> {
    await zeroclawProvision(sandbox, {
      binPath: `${root}/bin/zeroclaw`,
      agentDir: `${root}/agent`,
      localAgentDir: opts.localAgentDir,
      secretKey: opts.secretKey,
      fromSnapshot: opts.fromSnapshot,
    });
  }

  getAvailableTools(): Tool[] {
    return [new AgentBrowserTool(), new GhCliTool(), new FindSkillsTool()];
  }

  getEnabledTools(agentDir: string): Tool[] {
    try {
      const configPath = join(agentDir, "config.toml");
      if (!existsSync(configPath)) return [];

      const raw = readFileSync(configPath, "utf-8");
      const config = TOML.parse(raw) as unknown as ZeroClawConfig;

      const tools: Tool[] = [];
      if (config.browser?.enabled) tools.push(new AgentBrowserTool());
      return tools;
    } catch {
      return [];
    }
  }

  async sendMessage(
    sandbox: SandboxHandle,
    root: string,
    message: string,
    opts?: {
      env?: Record<string, string>;
      signal?: AbortSignal;
      threadId?: string;
    },
  ): Promise<AgentResponse> {
    // Try daemon WebSocket first (if domain() is available)
    if (typeof sandbox.domain === "function") {
      try {
        log.info(`sendMessage via daemon WS, threadId=${opts?.threadId ?? "(none)"}`);
        return await sendMessageViaDaemon(sandbox, root, message, opts);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn(`Daemon WS failed, falling back to CLI: ${msg}`);
        } else {
          throw err;
        }
      }
    }

    // Fallback: CLI one-shot (no session support)
    log.info(
      `sendMessage via CLI one-shot (no session support), threadId=${opts?.threadId ?? "(none)"}`,
    );
    return sendMessageViaCli(sandbox, root, message, this.env(root), opts);
  }

  async streamMessage(
    sandbox: SandboxHandle,
    root: string,
    message: string,
    writer: UIMessageStreamWriter,
    opts?: { signal?: AbortSignal; threadId?: string },
  ): Promise<void> {
    if (typeof sandbox.domain !== "function") {
      // No daemon available — fall back to batch sendMessage and write result
      const resp = await this.sendMessage(sandbox, root, message, opts);
      const textId = crypto.randomUUID();
      if (resp.success) {
        writer.write({ type: "text-start", id: textId });
        writer.write({ type: "text-delta", id: textId, delta: resp.message });
        writer.write({ type: "text-end", id: textId });
      } else {
        writer.write({ type: "error", errorText: resp.error ?? resp.message });
      }
      return;
    }

    await streamMessageViaDaemon(sandbox, root, message, writer, opts);
  }

  async listThreads(
    sandbox: SandboxHandle,
    root: string,
    opts?: { signal?: AbortSignal },
  ): Promise<ThreadInfo[]> {
    if (typeof sandbox.domain !== "function") return [];
    try {
      return await listThreadsViaDaemon(sandbox, opts);
    } catch {
      return [];
    }
  }

  async getThread(
    sandbox: SandboxHandle,
    root: string,
    threadId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<UIMessage[]> {
    if (typeof sandbox.domain !== "function") return [];
    try {
      return await getThreadViaDaemon(sandbox, threadId, opts);
    } catch {
      return [];
    }
  }

  getDaemonCommand(
    root: string,
    opts?: {
      port?: number;
      host?: string;
      env?: Record<string, string>;
    },
  ): DaemonCommand {
    const cmd = buildDaemonCommand(`${root}/bin/zeroclaw`, this.env(root), opts);
    return {
      cmd: cmd.cmd,
      args: cmd.args,
      env: { ...cmd.env, ...opts?.env },
    };
  }

  getMonitorConfig(root: string): MonitorConfig {
    return {
      dir: `${root}/agent`,
      ignoreFiles: HOUSEKEEPING_FILES,
    };
  }

  // --- Catalog delegates ---

  getProviders(): ProviderInfo[] {
    return PROVIDERS;
  }

  getDefaultModel(provider: string): string {
    return getDefaultModel(provider);
  }

  getCuratedModels(provider: string): CuratedModel[] {
    return getCuratedModels(provider);
  }

  getModelsFetchEndpoint(
    provider: string,
    apiUrl?: string,
  ): { url: string; authHeader: (key: string) => Record<string, string> } | null {
    return getModelsFetchEndpoint(provider, apiUrl);
  }

  getSupportedChannels(): ChannelInfo[] {
    return CHANNELS;
  }

  // --- Config delegates ---

  writeSetupConfig(agentDir: string, data: AgentSetupData): void {
    writeSetupConfig(agentDir, data, CHANNELS);
  }

  readSetup(agentDir: string): {
    provider?: Partial<ProviderSetup>;
    channels?: Record<string, Record<string, string>>;
  } | null {
    return readSetup(agentDir);
  }

  // --- Static metadata ---

  getToolDomains(agentDir: string): Tool[] {
    return this.getEnabledTools(agentDir);
  }

  getLocalOwnedFiles(): string[] {
    return ["config.toml", ".secret_key"];
  }

  getBundleFiles(): string[] {
    return ["config.toml", ".secret_key", "workspace/*.md", "workspace/skills/**/*"];
  }

  getSeedDirectory(): string | null {
    return "workspace";
  }

  getInstallDependencies(): Record<string, string> {
    return { zeroclaw: "0.1.2" };
  }

  getBinaryBundlePaths(): string[] {
    return ["node_modules/zeroclaw/dist/bin/**/*"];
  }

  // --- Dashboard API methods ---

  async getStatus(
    sandbox: SandboxHandle,
    _root: string,
    opts?: { signal?: AbortSignal },
  ): Promise<AgentStatus> {
    if (typeof sandbox.domain !== "function") return {};
    return fetchAgentStatus(sandbox, opts);
  }

  async getConfig(
    sandbox: SandboxHandle,
    _root: string,
    opts?: { signal?: AbortSignal },
  ): Promise<AgentConfig> {
    if (typeof sandbox.domain !== "function") {
      return { format: "toml", content: "" };
    }
    return fetchAgentConfig(sandbox, opts);
  }

  async listTools(
    sandbox: SandboxHandle,
    _root: string,
    opts?: { signal?: AbortSignal },
  ): Promise<ToolsResult> {
    if (typeof sandbox.domain !== "function") {
      return { tools: [], cliTools: [] };
    }
    return fetchRuntimeTools(sandbox, opts);
  }

  async listCronJobs(
    sandbox: SandboxHandle,
    _root: string,
    opts?: { signal?: AbortSignal },
  ): Promise<CronJob[]> {
    if (typeof sandbox.domain !== "function") return [];
    return fetchCronJobs(sandbox, opts);
  }

  async createCronJob(
    sandbox: SandboxHandle,
    _root: string,
    job: CreateCronJobInput,
    opts?: { signal?: AbortSignal },
  ): Promise<CronJob> {
    if (typeof sandbox.domain !== "function") {
      throw new Error("Sandbox domain unavailable");
    }
    return postCronJob(sandbox, job, opts);
  }

  async deleteCronJob(
    sandbox: SandboxHandle,
    _root: string,
    id: string,
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    if (typeof sandbox.domain !== "function") {
      throw new Error("Sandbox domain unavailable");
    }
    await deleteCronJobVia(sandbox, id, opts);
  }

  async listMemories(
    sandbox: SandboxHandle,
    _root: string,
    query?: MemoryQuery,
    opts?: { signal?: AbortSignal },
  ): Promise<MemoryEntryInfo[]> {
    if (typeof sandbox.domain !== "function") return [];
    return fetchMemories(sandbox, query, opts);
  }

  async createMemory(
    sandbox: SandboxHandle,
    _root: string,
    entry: CreateMemoryInput,
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    if (typeof sandbox.domain !== "function") {
      throw new Error("Sandbox domain unavailable");
    }
    await postMemory(sandbox, entry, opts);
  }

  async deleteMemory(
    sandbox: SandboxHandle,
    _root: string,
    key: string,
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    if (typeof sandbox.domain !== "function") {
      throw new Error("Sandbox domain unavailable");
    }
    await deleteMemoryEntry(sandbox, key, opts);
  }

  async getCostInfo(
    sandbox: SandboxHandle,
    root: string,
    opts?: { signal?: AbortSignal },
  ): Promise<CostInfo> {
    if (typeof sandbox.domain !== "function") return {};
    const costInfo = await fetchCostInfo(sandbox, opts);

    // Read cost limits from config.toml inside the sandbox
    try {
      const buf = await sandbox.readFile(`${root}/agent/config.toml`);
      if (buf) {
        const config = TOML.parse(buf.toString("utf-8"));
        const cost = config.cost as Record<string, unknown> | undefined;
        if (cost) {
          if (typeof cost.daily_limit_usd === "number") {
            costInfo.dailyLimitUsd = cost.daily_limit_usd;
          }
          if (typeof cost.monthly_limit_usd === "number") {
            costInfo.monthlyLimitUsd = cost.monthly_limit_usd;
          }
        }
      }
    } catch {
      // Config read failure is non-fatal — limits just won't show
    }

    return costInfo;
  }

  async runDiagnostics(
    sandbox: SandboxHandle,
    _root: string,
    opts?: { signal?: AbortSignal },
  ): Promise<DiagResult[]> {
    if (typeof sandbox.domain !== "function") return [];
    return fetchDiagnostics(sandbox, opts);
  }
}

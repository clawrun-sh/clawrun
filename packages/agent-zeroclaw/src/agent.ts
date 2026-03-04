import {
  provision as zeroclawProvision,
  parseCronListOutput,
  buildDaemonCommand,
  buildCronListCommand,
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
  CronInfo,
  DaemonCommand,
  MonitorConfig,
  ProvisionOpts,
  ProviderInfo,
  ProviderSetup,
  CuratedModel,
  ChannelInfo,
  AgentSetupData,
} from "@clawrun/agent";
import type { Tool } from "@clawrun/agent";
import { AgentBrowserTool, GhCliTool } from "@clawrun/agent";
import { createLogger } from "@clawrun/logger";

const log = createLogger("agent:zeroclaw");

import {
  sendMessageViaCli,
  sendMessageViaDaemon,
  streamMessageViaDaemon,
  fetchHistoryViaDaemon,
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
    return [new AgentBrowserTool(), new GhCliTool()];
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
      sessionId?: string;
    },
  ): Promise<AgentResponse> {
    // Try daemon WebSocket first (if domain() is available)
    if (typeof sandbox.domain === "function") {
      try {
        log.info(`sendMessage via daemon WS, sessionId=${opts?.sessionId ?? "(none)"}`);
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
      `sendMessage via CLI one-shot (no session support), sessionId=${opts?.sessionId ?? "(none)"}`,
    );
    return sendMessageViaCli(sandbox, root, message, this.env(root), opts);
  }

  async streamMessage(
    sandbox: SandboxHandle,
    root: string,
    message: string,
    writer: { write(part: unknown): void },
    opts?: { signal?: AbortSignal; sessionId?: string },
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

    await streamMessageViaDaemon(
      sandbox,
      root,
      message,
      // Cast to UIMessageStreamWriter — structurally compatible
      writer as import("ai").UIMessageStreamWriter,
      opts,
    );
  }

  async fetchHistory(
    sandbox: SandboxHandle,
    root: string,
    sessionId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<Array<{ role: string; content: string }>> {
    if (typeof sandbox.domain !== "function") return [];
    try {
      return await fetchHistoryViaDaemon(sandbox, root, sessionId, opts);
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

  async getCrons(sandbox: SandboxHandle, root: string): Promise<CronInfo> {
    const cmd = buildCronListCommand(`${root}/bin/zeroclaw`, {
      ZEROCLAW_WORKSPACE: `${root}/agent`,
    });
    const result = await sandbox.runCommand({
      cmd: cmd.cmd,
      args: cmd.args,
      env: cmd.env,
    });
    const stdout = await result.stdout();
    return parseCronListOutput(stdout);
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
    return ["config.toml", ".secret_key", "workspace/*.md"];
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
}

import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { SandboxProvider, ManagedSandbox, SandboxInfo } from "@cloudclaw/provider";
import { CountBasedRetention } from "@cloudclaw/provider";
import { VercelSandboxProvider } from "@cloudclaw/provider/vercel";
import type { AgentAdapter, AgentEnv, ChannelConfig } from "zeroclaw/adapter";
import { getAgent } from "../agents/registry";
import { hasAnyAlwaysOn } from "../channels/types";
import { registerTelegramWakeWebhook } from "../channels/telegram-wake";
import { getStateStore } from "../storage/state";
import type { StateStore } from "../storage/state-types";

// --- Constants ---

// Short initial timeout — enough for boot + first extend call
const INITIAL_SANDBOX_TIMEOUT_MS = 5 * 60 * 1000;

// How much time each extend call adds
const EXTEND_DURATION_MS = 3 * 60 * 1000;

// Sandbox calls extend every 60s
const EXTEND_INTERVAL_S = 60;

// Default active duration — how long sandbox stays alive after last activity
const DEFAULT_ACTIVE_DURATION_MS = 10 * 60 * 1000;

// How long to keep sandbox alive when a cron job is due soon
const CRON_KEEP_ALIVE_WINDOW_MS = 15 * 60 * 1000;

// Wait for daemon to initialize after starting
const DAEMON_INIT_WAIT_MS = 3_000;

// --- State keys ---

const STATE_SNAPSHOT_ID = "latest_snapshot_id";
const STATE_NEXT_WAKE_AT = "next_wake_at";

interface ScheduleConfig {
  wakeIntervalMs: number;
  activeDurationMs: number;
}

export interface HeartbeatResult {
  action: "running" | "sleeping" | "failed";
  sandboxId?: string;
  error?: string;
  nextWakeAt?: string;
}

export interface ExtendResult {
  action: "extended" | "stopped" | "error";
  error?: string;
  nextWakeAt?: string;
}

export interface SandboxStatus {
  running: boolean;
  sandboxId?: string;
  status?: string;
  startedAt?: Date;
}

function getAgentEnv(): AgentEnv {
  const llmProvider = process.env.CLOUDCLAW_LLM_PROVIDER ?? "anthropic";
  const llmApiKey = process.env.CLOUDCLAW_LLM_API_KEY;
  const llmModel = process.env.CLOUDCLAW_LLM_MODEL ?? "claude-sonnet-4-20250514";

  if (!llmApiKey) {
    throw new Error("CLOUDCLAW_LLM_API_KEY environment variable is required");
  }

  return { llmProvider, llmApiKey, llmModel };
}

function getChannelConfig(): ChannelConfig {
  const channels: ChannelConfig = {};

  const telegramToken = process.env.CLOUDCLAW_TELEGRAM_BOT_TOKEN;
  if (telegramToken) {
    channels.telegram = { botToken: telegramToken };
  }

  const discordToken = process.env.CLOUDCLAW_DISCORD_BOT_TOKEN;
  if (discordToken) {
    channels.discord = { botToken: discordToken };
  }

  const slackToken = process.env.CLOUDCLAW_SLACK_BOT_TOKEN;
  if (slackToken) {
    channels.slack = {
      botToken: slackToken,
      appToken: process.env.CLOUDCLAW_SLACK_APP_TOKEN,
    };
  }

  return channels;
}

function getDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
}

function resolveAssetPath(localPath: string): string {
  return isAbsolute(localPath) ? localPath : join(process.cwd(), localPath);
}

export class SandboxLifecycleManager {
  private adapter: AgentAdapter = getAgent();
  private state: StateStore | null = getStateStore();
  private provider: SandboxProvider = new VercelSandboxProvider();
  private retention = new CountBasedRetention(3);

  private getScheduleConfig(): ScheduleConfig {
    const wakeInterval = parseInt(process.env.CLOUDCLAW_SANDBOX_WAKE_INTERVAL ?? "60", 10);
    const activeDuration = parseInt(
      process.env.CLOUDCLAW_SANDBOX_ACTIVE_DURATION ?? "10",
      10,
    );

    return {
      wakeIntervalMs: wakeInterval * 60 * 1000,
      activeDurationMs: activeDuration * 60 * 1000 || DEFAULT_ACTIVE_DURATION_MS,
    };
  }

  /** List sandboxes for this project (newest-first from API). */
  private async listSandboxes(): Promise<SandboxInfo[]> {
    return this.provider.list();
  }

  private isTerminal(s: SandboxInfo): boolean {
    return s.status === "stopped" || s.status === "failed" || s.status === "aborted";
  }

  /** Stop the given sandboxes. Re-fetches each to get current status. */
  private async stopSandboxes(toStop: SandboxInfo[]): Promise<void> {
    for (const s of toStop) {
      try {
        const sandbox = await this.provider.get(s.id);
        const current = sandbox.status;

        // Only stop if actually stoppable
        if (current === "running" || current === "pending") {
          console.log(`[CloudClaw] Stopping sandbox ${s.id} (status: ${current})`);
          await sandbox.stop();
          console.log(`[CloudClaw] Stopped sandbox ${s.id}`);
        } else {
          console.log(`[CloudClaw] Skipping sandbox ${s.id} (status: ${current}, not stoppable)`);
        }
      } catch (err) {
        console.error(`[CloudClaw] Failed to stop sandbox ${s.id}:`, err);
      }
    }
  }

  /**
   * Snapshot a running sandbox and stop it. Returns the snapshot ID if
   * successful, null otherwise. On failure, attempts a plain stop.
   */
  private async snapshotAndStop(sandboxId: string): Promise<string | null> {
    try {
      const sandbox = await this.provider.get(sandboxId);
      if (sandbox.status !== "running") return null;

      console.log(`[CloudClaw] Snapshotting sandbox ${sandboxId}`);
      const snapshot = await sandbox.snapshot();
      console.log(`[CloudClaw] Snapshot created: ${snapshot.id}`);
      await this.applyRetention();
      return snapshot.id;
    } catch (err) {
      console.error(`[CloudClaw] Snapshot failed:`, err);
      try {
        const sandbox = await this.provider.get(sandboxId);
        await sandbox.stop();
      } catch {
        // best-effort
      }
      return null;
    }
  }

  /** Delete old snapshots beyond the retention count. */
  private async applyRetention(): Promise<void> {
    try {
      const snapshots = await this.provider.listSnapshots();
      const toDelete = this.retention.selectForDeletion(snapshots);
      for (const id of toDelete) {
        await this.provider.deleteSnapshot(id);
        console.log(`[CloudClaw] Deleted old snapshot: ${id}`);
      }
    } catch (err) {
      console.error("[CloudClaw] Snapshot retention cleanup failed:", err);
    }
  }

  /**
   * Query ZeroClaw's cron schedule inside the sandbox.
   * Returns the earliest next_run among all enabled jobs, or null.
   */
  private async getNextCronRun(sandbox: ManagedSandbox): Promise<Date | null> {
    try {
      const result = await sandbox.runCommand({
        cmd: "zeroclaw",
        args: ["cron", "list", "--json"],
        signal: AbortSignal.timeout(5000),
      });
      if (result.exitCode !== 0) return null;

      const stdout = await result.stdout();
      const jobs = JSON.parse(stdout);
      const nextRuns = jobs
        .filter((j: { enabled?: boolean }) => j.enabled)
        .map((j: { next_run?: string }) => new Date(j.next_run ?? "").getTime())
        .filter((t: number) => !isNaN(t));

      if (nextRuns.length === 0) return null;
      return new Date(Math.min(...nextRuns));
    } catch {
      return null;
    }
  }

  /**
   * Decide whether a running sandbox should stay alive.
   *
   * Note: ZeroClaw's health endpoint does NOT expose a "last user message"
   * metric — channels.last_ok updates on every long-poll restart (~30s),
   * not on actual messages. So we rely on activeDurationMs as the session
   * length. When a user messages after stop, the webhook wakes it back up.
   */
  private async shouldKeepAlive(
    _sandbox: ManagedSandbox,
    schedule: ScheduleConfig,
    startedAt: number,
  ): Promise<boolean> {
    // 1. Always-on (channel-level, e.g. CLOUDCLAW_TELEGRAM_ALWAYS_ON=true)
    if (hasAnyAlwaysOn()) return true;

    // 2. Still within active duration (default 10 min)
    const elapsed = Date.now() - startedAt;
    if (elapsed < schedule.activeDurationMs) return true;

    // 3. Cron job due soon — no point sleeping if we'd wake right back up
    const nextCron = await this.getNextCronRun(_sandbox);
    if (nextCron) {
      const timeUntilJob = nextCron.getTime() - Date.now();
      if (timeUntilJob <= CRON_KEEP_ALIVE_WINDOW_MS) return true;
    }

    return false;
  }

  async heartbeat(): Promise<HeartbeatResult> {
    const schedule = this.getScheduleConfig();
    const sandboxes = await this.listSandboxes();

    // Find all non-terminal sandboxes
    const active = sandboxes.filter((s) => !this.isTerminal(s));
    console.log(
      `[CloudClaw] Heartbeat: ${sandboxes.length} listed, ${active.length} active:`,
      active.map((s) => `${s.id}(${s.status})`).join(", ") || "none",
    );

    // 1. CLEANUP: stop duplicates — keep only the newest
    if (active.length > 1) {
      const sorted = [...active].sort((a, b) => b.createdAt - a.createdAt);
      const keeper = sorted[0];
      const duplicates = sorted.slice(1);
      console.log(
        `[CloudClaw] Stopping ${duplicates.length} duplicate(s), keeping ${keeper.id}`,
      );
      await this.stopSandboxes(duplicates);
    }

    // 2. RUNNING SANDBOX: decide keep-alive vs sleep
    if (active.length > 0) {
      const newest = [...active].sort((a, b) => b.createdAt - a.createdAt)[0];

      if (newest.status === "running") {
        const sandbox = await this.provider.get(newest.id);
        const startedAt = newest.startedAt ?? newest.createdAt;
        const elapsed = Date.now() - startedAt;
        const remaining = newest.timeout - elapsed;

        // Should it keep running?
        if (await this.shouldKeepAlive(sandbox, schedule, startedAt)) {
          return { action: "running", sandboxId: newest.id };
        }

        // Time to sleep: query cron, snapshot, stop
        const nextCron = await this.getNextCronRun(sandbox);
        const snapshotId = await this.snapshotAndStop(newest.id);
        if (snapshotId) {
          await this.state?.set(STATE_SNAPSHOT_ID, snapshotId);
        }
        if (nextCron) {
          await this.state?.set(STATE_NEXT_WAKE_AT, nextCron.toISOString());
        }
        return {
          action: "sleeping",
          sandboxId: newest.id,
          nextWakeAt: nextCron?.toISOString(),
        };
      }

      // pending/stopping — don't interfere
      return { action: "running", sandboxId: newest.id };
    }

    // 3. NO SANDBOX: decide whether to wake
    if (hasAnyAlwaysOn()) {
      console.log("[CloudClaw] Always-on channel detected, creating sandbox");
      return this.startNew(sandboxes);
    }

    // Check for cron-triggered wake
    const nextWakeAtStr = await this.state?.get(STATE_NEXT_WAKE_AT);
    if (nextWakeAtStr) {
      const nextWakeAt = new Date(nextWakeAtStr);
      if (nextWakeAt.getTime() <= Date.now()) {
        console.log("[CloudClaw] Cron-triggered wake (next_wake_at due)");
        await this.state?.delete(STATE_NEXT_WAKE_AT);
        return this.startNew(sandboxes);
      }
    }

    // Duty-cycle: check wake interval
    const lastStopped = sandboxes
      .filter((s) => s.stoppedAt)
      .sort((a, b) => (b.stoppedAt ?? 0) - (a.stoppedAt ?? 0))[0];

    if (!lastStopped?.stoppedAt) {
      // No sandbox has ever run — first boot
      return this.startNew(sandboxes);
    }

    const elapsed = Date.now() - lastStopped.stoppedAt;
    if (schedule.wakeIntervalMs > 0 && elapsed >= schedule.wakeIntervalMs) {
      return this.startNew(sandboxes);
    }

    const nextWakeAt = schedule.wakeIntervalMs > 0
      ? new Date(lastStopped.stoppedAt + schedule.wakeIntervalMs)
      : undefined;
    return {
      action: "sleeping",
      sandboxId: lastStopped.id,
      nextWakeAt: nextWakeAt?.toISOString() ?? nextWakeAtStr ?? undefined,
    };
  }

  /**
   * Wake — start a sandbox if none is running.
   *
   * Called by the Telegram webhook handler when a message arrives and the
   * sandbox is stopped. Unlike heartbeat(), this does NOT make keep-alive
   * or sleep decisions — it only ensures a sandbox exists.
   */
  async wake(): Promise<HeartbeatResult> {
    const sandboxes = await this.listSandboxes();
    const active = sandboxes.filter((s) => !this.isTerminal(s));

    if (active.length > 0) {
      const newest = [...active].sort((a, b) => b.createdAt - a.createdAt)[0];
      return { action: "running", sandboxId: newest.id };
    }

    console.log("[CloudClaw] Wake: no active sandbox, starting one");
    return this.startNew(sandboxes);
  }

  /**
   * Handle an extend request from the sandbox's internal loop.
   *
   * Called every 60s by a background curl inside the sandbox. Decides
   * whether to extend the sandbox timeout or let it stop gracefully.
   */
  async handleExtend(sandboxId: string): Promise<ExtendResult> {
    let sandbox: ManagedSandbox;
    try {
      sandbox = await this.provider.get(sandboxId);
    } catch (err) {
      return { action: "error", error: `Cannot get sandbox: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (sandbox.status !== "running") {
      return { action: "error", error: `Sandbox not running (status: ${sandbox.status})` };
    }

    const schedule = this.getScheduleConfig();
    const info = (await this.listSandboxes()).find((s) => s.id === sandboxId);
    const startedAt = info?.startedAt ?? info?.createdAt ?? Date.now();

    if (await this.shouldKeepAlive(sandbox, schedule, startedAt)) {
      try {
        await sandbox.extendTimeout(EXTEND_DURATION_MS);
        return { action: "extended" };
      } catch (err) {
        // Extension failed (plan ceiling, API error) — fall through to
        // graceful stop instead of leaving sandbox in limbo
        console.error("[CloudClaw] extendTimeout failed, stopping gracefully:", err);
      }
    }

    // Idle or extend failed: snapshot + stop + register webhook
    const nextCron = await this.getNextCronRun(sandbox);
    const snapshotId = await this.snapshotAndStop(sandboxId);
    if (snapshotId) await this.state?.set(STATE_SNAPSHOT_ID, snapshotId);
    if (nextCron) await this.state?.set(STATE_NEXT_WAKE_AT, nextCron.toISOString());

    // Register wake hooks — sandbox is now stopped
    if (process.env.CLOUDCLAW_TELEGRAM_BOT_TOKEN) {
      await registerTelegramWakeWebhook();
    }

    return { action: "stopped", nextWakeAt: nextCron?.toISOString() };
  }

  async forceRestart(): Promise<HeartbeatResult> {
    const sandboxes = await this.listSandboxes();

    // Stop all non-terminal sandboxes (not just running — pending counts too)
    const active = sandboxes.filter((s) => !this.isTerminal(s));
    if (active.length > 0) {
      await this.stopSandboxes(active);
    }

    return this.startNew(sandboxes);
  }

  async getStatus(): Promise<SandboxStatus> {
    const sandboxes = await this.listSandboxes();
    const running = sandboxes.find((s) => s.status === "running");

    if (running) {
      return {
        running: true,
        sandboxId: running.id,
        status: running.status,
        startedAt: new Date(running.startedAt ?? running.createdAt),
      };
    }

    // Return info about the most recently active sandbox
    const latest = sandboxes
      .sort((a, b) => b.createdAt - a.createdAt)[0];

    if (latest) {
      return {
        running: false,
        sandboxId: latest.id,
        status: latest.status,
      };
    }

    return { running: false };
  }

  private async startNew(
    _sandboxes: SandboxInfo[],
  ): Promise<HeartbeatResult> {
    const timeoutMs = INITIAL_SANDBOX_TIMEOUT_MS;

    try {
      // 1. Try resuming from stored snapshot (StateStore)
      const storedSnapshotId = await this.state?.get(STATE_SNAPSHOT_ID);
      let sandbox: ManagedSandbox | null = null;

      if (storedSnapshotId) {
        try {
          sandbox = await this.provider.create({
            snapshotId: storedSnapshotId,
            timeout: timeoutMs,
            ports: [3000],
          });
          console.log(`[CloudClaw] Resumed from stored snapshot: ${storedSnapshotId}`);
        } catch {
          // Snapshot may be expired — clear and fall through
          console.log(`[CloudClaw] Stored snapshot invalid, clearing`);
          sandbox = null;
          await this.state?.delete(STATE_SNAPSHOT_ID);
        }
      }

      // 2. Try latest snapshot from provider
      if (!sandbox) {
        try {
          const snapshots = await this.provider.listSnapshots();
          const latest = snapshots.sort((a, b) => b.createdAt - a.createdAt)[0];
          if (latest) {
            try {
              sandbox = await this.provider.create({
                snapshotId: latest.id,
                timeout: timeoutMs,
                ports: [3000],
              });
              console.log(`[CloudClaw] Resumed from latest snapshot: ${latest.id}`);
            } catch {
              sandbox = null;
            }
          }
        } catch {
          // No snapshot API available — fall through
        }
      }

      // 3. Fresh sandbox — install binary
      if (!sandbox) {
        sandbox = await this.provider.create({
          timeout: timeoutMs,
          ports: [3000],
        });
        await this.installBinary(sandbox);
      }

      await this.writeDaemonConfig(sandbox);
      await this.startDaemon(sandbox);
      await this.startSandboxExtendLoop(sandbox);

      return { action: "running", sandboxId: sandbox.id };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { action: "failed", error };
    }
  }

  /**
   * Start a background loop inside the sandbox that calls the parent's
   * /api/sandbox/extend endpoint every 60s. The parent decides whether
   * to extend the timeout or let the sandbox stop gracefully.
   */
  private async startSandboxExtendLoop(sandbox: ManagedSandbox): Promise<void> {
    const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    const secret = process.env.CRON_SECRET ?? process.env.CLOUDCLAW_CRON_SECRET;
    if (!host || !secret) {
      console.log(`[CloudClaw] Cannot start extend loop — host=${host ?? "UNSET"}, secret=${secret ? "set" : "UNSET"}`);
      return;
    }

    const url = `https://${host}/api/sandbox/extend`;
    const id = sandbox.id;

    const script = [
      `const URL = ${JSON.stringify(url)};`,
      `const SECRET = ${JSON.stringify(secret)};`,
      `const BODY = JSON.stringify({ sandboxId: ${JSON.stringify(id)} });`,
      `const INTERVAL = ${EXTEND_INTERVAL_S} * 1000;`,
      ``,
      `async function extend() {`,
      `  try {`,
      `    const res = await fetch(URL, {`,
      `      method: "POST",`,
      `      headers: {`,
      `        "Authorization": "Bearer " + SECRET,`,
      `        "Content-Type": "application/json",`,
      `      },`,
      `      body: BODY,`,
      `    });`,
      `    const data = await res.json();`,
      `    console.log("[extend-loop]", JSON.stringify(data));`,
      `  } catch (err) {`,
      `    console.error("[extend-loop] error:", err.message);`,
      `  }`,
      `}`,
      ``,
      `extend();`,
      `setInterval(extend, INTERVAL);`,
    ].join("\n");

    const scriptPath = "/tmp/cloudclaw-extend-loop.mjs";

    try {
      await sandbox.writeFiles([
        { path: scriptPath, content: Buffer.from(script) },
      ]);
      await sandbox.runCommand({
        cmd: "node",
        args: [scriptPath],
        detached: true,
      });
      console.log(`[CloudClaw] Extend loop started for sandbox ${id}, url=${url}`);
    } catch (err) {
      console.error("[CloudClaw] Failed to start extend loop:", err);
    }
  }

  private async installBinary(sandbox: ManagedSandbox): Promise<void> {
    const assets = this.adapter.binaryAssets();
    if (assets.length > 0) {
      const parentDirs = new Set(
        assets.map((a) =>
          a.sandboxPath.substring(0, a.sandboxPath.lastIndexOf("/")),
        ),
      );
      for (const dir of parentDirs) {
        await sandbox.runCommand("mkdir", ["-p", dir]);
      }

      await sandbox.writeFiles(
        assets.map((asset) => ({
          path: asset.sandboxPath,
          content: readFileSync(resolveAssetPath(asset.localPath)),
        })),
      );
    }

    for (const installCmd of this.adapter.installCommands()) {
      const result = await sandbox.runCommand({
        cmd: installCmd.cmd,
        args: installCmd.args,
        env: installCmd.env,
      });
      if (result.exitCode !== 0) {
        const stderr = await result.stderr();
        throw new Error(`Install step failed: ${stderr}`);
      }
    }
  }

  private async writeDaemonConfig(sandbox: ManagedSandbox): Promise<void> {
    const env = getAgentEnv();
    const channels = getChannelConfig();
    const databaseUrl = getDatabaseUrl();
    const configPath = "/tmp/.zeroclaw/config.toml";

    // Step 1: Run onboard to generate a valid base config with all required fields
    if (this.adapter.onboardCommand) {
      const onboard = this.adapter.onboardCommand(env);
      const onboardEnv = {
        ...onboard.env,
        ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
      };
      const onboardResult = await sandbox.runCommand({
        cmd: onboard.cmd,
        args: onboard.args,
        env: onboardEnv,
      });
      if (onboardResult.exitCode !== 0) {
        const stderr = await onboardResult.stderr();
        throw new Error(`Onboard failed: ${stderr}`);
      }
    }

    // Step 2: Patch the onboard-generated config for daemon mode
    const sedPatches = [
      // Autonomy: supervised -> full
      's/level = "supervised"/level = "full"/',
      // Gateway: bind to 0.0.0.0 instead of 127.0.0.1
      's/host = "127.0.0.1"/host = "0.0.0.0"/',
      // Gateway: disable pairing requirement
      "s/require_pairing = true/require_pairing = false/",
      // Gateway: allow public bind
      "s/allow_public_bind = false/allow_public_bind = true/",
    ];
    for (const expr of sedPatches) {
      await sandbox.runCommand("sed", ["-i", expr, configPath]);
    }

    // Append channel configs (ZeroClaw uses [channels_config.*] not [channels.*])
    if (channels.telegram) {
      const tgCfg = [
        "",
        "[channels_config.telegram]",
        `bot_token = "${channels.telegram.botToken}"`,
        `allowed_users = ["*"]`,
      ].join("\\n");
      await sandbox.runCommand("sh", [
        "-c",
        `grep -q '\\[channels_config.telegram\\]' ${configPath} || printf '${tgCfg}\\n' >> ${configPath}`,
      ]);
    }

    if (channels.discord) {
      const dcCfg = [
        "",
        "[channels_config.discord]",
        `bot_token = "${channels.discord.botToken}"`,
      ].join("\\n");
      await sandbox.runCommand("sh", [
        "-c",
        `grep -q '\\[channels_config.discord\\]' ${configPath} || printf '${dcCfg}\\n' >> ${configPath}`,
      ]);
    }

    if (channels.slack) {
      const slCfg = [
        "",
        "[channels_config.slack]",
        `bot_token = "${channels.slack.botToken}"`,
        ...(channels.slack.appToken
          ? [`app_token = "${channels.slack.appToken}"`]
          : []),
      ].join("\\n");
      await sandbox.runCommand("sh", [
        "-c",
        `grep -q '\\[channels_config.slack\\]' ${configPath} || printf '${slCfg}\\n' >> ${configPath}`,
      ]);
    }
  }

  private async startDaemon(sandbox: ManagedSandbox) {
    if (!this.adapter.buildDaemonCommand) {
      throw new Error(
        `Adapter "${this.adapter.id}" does not support daemon mode`,
      );
    }

    const command = this.adapter.buildDaemonCommand();
    const databaseUrl = getDatabaseUrl();

    const daemonCmd = await sandbox.runCommand({
      cmd: command.cmd,
      args: command.args,
      env: {
        ...command.env,
        ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
      },
      detached: true,
    });

    // Wait for daemon to initialize
    await new Promise((resolve) => setTimeout(resolve, DAEMON_INIT_WAIT_MS));

    return daemonCmd;
  }
}

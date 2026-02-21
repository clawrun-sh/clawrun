import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { SandboxProvider, ManagedSandbox, SandboxInfo } from "@cloudclaw/provider";
import { CountBasedRetention } from "@cloudclaw/provider";
import { VercelSandboxProvider } from "@cloudclaw/provider/vercel";
import { ZEROCLAW_HOME } from "zeroclaw/adapter";
import type { AgentAdapter, AgentEnv, ChannelConfig } from "zeroclaw/adapter";
import { getAgent } from "../agents/registry";
import { registerTelegramWakeWebhook } from "../channels/telegram-wake";
import { getStateStore } from "../storage/state";
import type { StateStore } from "../storage/state-types";
import type { ExtendReason } from "./extend-reasons";
import { FileActivityReason, CronScheduleReason } from "./extend-reasons";

// --- Constants ---

// Dead-man's switch multiplier: native TTL = activeDuration * this factor.
// Gives ~10 extend loop ticks worth of buffer before the sandbox dies
// from communication failure. Under normal operation the TTL is pushed
// forward on every extend tick so it never fires.
const NATIVE_TTL_MULTIPLIER = 10;

// How much time each extend call pushes the native TTL forward
const EXTEND_DURATION_MS = 3 * 60 * 1000;

// Sandbox calls extend every 60s
const EXTEND_INTERVAL_S = 60;

// How long to keep sandbox alive when a cron job is due soon
const CRON_KEEP_ALIVE_WINDOW_MS = 15 * 60 * 1000;

// Wait for daemon to initialize after starting
const DAEMON_INIT_WAIT_MS = 3_000;

// ZeroClaw binary path inside the sandbox
const ZEROCLAW_BIN = "/tmp/zeroclaw";

// Unified workspace for all ZeroClaw processes inside the sandbox.
// Must point to the config dir itself (flat layout) so resolve_config_dir_for_workspace()
// returns the same dir that onboard wrote config.toml and .secret_key to.
// Using /tmp/.zeroclaw/workspace would resolve to /tmp/.zeroclaw/.zeroclaw/ (wrong).
const ZEROCLAW_WORKSPACE = ZEROCLAW_HOME;

// --- State keys ---

const STATE_NEXT_WAKE_AT = "next_wake_at";

/** Active duration: grace period before idle-stop decisions + idle threshold. */
function getActiveDurationMs(): number {
  const minutes = parseInt(process.env.CLOUDCLAW_SANDBOX_ACTIVE_DURATION ?? "5", 10);
  return (minutes > 0 ? minutes : 5) * 60 * 1000;
}

export interface HeartbeatResult {
  action: "running" | "sleeping" | "failed";
  sandboxId?: string;
  error?: string;
  nextWakeAt?: string;
}

export interface ExtendPayload {
  sandboxId: string;
  /** Epoch ms of the last observed file change in ZEROCLAW_HOME. */
  lastChangedAt: number;
  nextCronAt: string | null;
  /** Number of cron jobs found by `zeroclaw cron list`. */
  cronJobCount?: number;
  /** Epoch ms when the extend loop started (approx sandbox creation time). */
  sandboxCreatedAt?: number;
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
  const memoryBackend = (process.env.CLOUDCLAW_MEMORY_BACKEND ?? "sqlite") as AgentEnv["memoryBackend"];

  if (!llmApiKey) {
    throw new Error("CLOUDCLAW_LLM_API_KEY environment variable is required");
  }

  return { llmProvider, llmApiKey, llmModel, memoryBackend };
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
  private extendReasons: ExtendReason[] = [
    new FileActivityReason(getActiveDurationMs()),
    new CronScheduleReason(CRON_KEEP_ALIVE_WINDOW_MS),
  ];

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

  /** Register wake hooks for all configured channels. */
  private async registerWakeHooks(): Promise<void> {
    if (process.env.CLOUDCLAW_TELEGRAM_BOT_TOKEN) {
      await registerTelegramWakeWebhook();
    }
    // if (process.env.CLOUDCLAW_DISCORD_BOT_TOKEN) await registerDiscordWakeHook();
    // if (process.env.CLOUDCLAW_SLACK_BOT_TOKEN)   await registerSlackWakeHook();
  }

  async heartbeat(): Promise<HeartbeatResult> {
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

    // 2. RUNNING SANDBOX: extend loop owns keep-alive decisions
    if (active.length > 0) {
      const newest = [...active].sort((a, b) => b.createdAt - a.createdAt)[0];
      return { action: "running", sandboxId: newest.id };
    }

    // 3. NO SANDBOX: decide whether to wake
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

    // First boot: no sandbox has ever existed
    const hasEverRun = sandboxes.some((s) => s.stoppedAt || s.status === "running");
    if (!hasEverRun && sandboxes.length === 0) {
      return this.startNew(sandboxes);
    }

    // Sleeping — waiting for event-driven wake (webhook or cron)
    const lastStopped = sandboxes
      .filter((s) => s.stoppedAt)
      .sort((a, b) => (b.stoppedAt ?? 0) - (a.stoppedAt ?? 0))[0];

    return {
      action: "sleeping",
      sandboxId: lastStopped?.id,
      nextWakeAt: nextWakeAtStr ?? undefined,
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
   * Handle an extend request from the sandbox's internal reporter loop.
   *
   * Called every 60s by a background script inside the sandbox. The script
   * reports filesystem mtime data and next cron schedule. The parent decides
   * whether to extend based on actual activity or upcoming work.
   */
  async handleExtend(payload: ExtendPayload): Promise<ExtendResult> {
    let sandbox: ManagedSandbox;
    try {
      sandbox = await this.provider.get(payload.sandboxId);
    } catch (err) {
      return { action: "error", error: `Cannot get sandbox: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (sandbox.status !== "running") {
      return { action: "error", error: `Sandbox not running (status: ${sandbox.status})` };
    }

    const now = Date.now();
    const idleMs = now - payload.lastChangedAt;
    const activeDurationMs = getActiveDurationMs();

    console.log(
      `[CloudClaw] Extend: sandbox=${payload.sandboxId},` +
      ` idle=${Math.round(idleMs / 1000)}s (threshold=${activeDurationMs / 1000}s),` +
      ` nextCronAt=${payload.nextCronAt ?? "none"},` +
      ` cronJobs=${payload.cronJobCount ?? "?"}`,
    );

    // Grace period: the sandbox is still within its initial native TTL.
    // Don't extend, don't evaluate stop — just acknowledge.
    if (payload.sandboxCreatedAt) {
      const elapsed = now - payload.sandboxCreatedAt;
      if (elapsed < activeDurationMs) {
        console.log(`[CloudClaw] Grace period (${Math.round(elapsed / 1000)}s / ${activeDurationMs / 1000}s), no action`);
        return { action: "extended" };
      }
    }

    // Past grace period — evaluate extend reasons (first match wins)
    let reason: string | null = null;
    for (const r of this.extendReasons) {
      reason = r.evaluate(payload, now);
      if (reason) break;
    }

    if (reason) {
      try {
        await sandbox.extendTimeout(EXTEND_DURATION_MS);
        console.log(`[CloudClaw] Extended sandbox ${payload.sandboxId} (+${EXTEND_DURATION_MS / 1000}s, reason: ${reason})`);
        return { action: "extended" };
      } catch (err) {
        // Extension failed (plan ceiling, API error) — fall through to
        // graceful stop instead of leaving sandbox in limbo
        console.error("[CloudClaw] extendTimeout failed, stopping gracefully:", err);
      }
    }

    // No reason to extend (or extend failed) → snapshot + stop
    console.log(`[CloudClaw] No activity, stopping sandbox ${payload.sandboxId}`);
    await this.snapshotAndStop(payload.sandboxId);
    if (payload.nextCronAt) await this.state?.set(STATE_NEXT_WAKE_AT, payload.nextCronAt);

    await this.registerWakeHooks();

    return { action: "stopped", nextWakeAt: payload.nextCronAt ?? undefined };
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
    try {
      let sandbox: ManagedSandbox | null = null;

      // 1. Try latest snapshot from provider
      try {
        const snapshots = await this.provider.listSnapshots();
        const latest = snapshots.sort((a, b) => b.createdAt - a.createdAt)[0];
        if (latest) {
          try {
            sandbox = await this.provider.create({
              snapshotId: latest.id,
              timeout: getActiveDurationMs() * NATIVE_TTL_MULTIPLIER,
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

      // 2. Fresh sandbox — install binary
      if (!sandbox) {
        sandbox = await this.provider.create({
          timeout: getActiveDurationMs() * NATIVE_TTL_MULTIPLIER,
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
   * Start a background reporter inside the sandbox that calls the parent's
   * /api/sandbox/extend endpoint every 60s with filesystem mtime data and
   * next cron schedule. The parent decides whether to extend or stop.
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
      `import { readdirSync, statSync } from "node:fs";`,
      `import { join } from "node:path";`,
      `import { execSync } from "node:child_process";`,
      ``,
      `const URL = ${JSON.stringify(url)};`,
      `const SECRET = ${JSON.stringify(secret)};`,
      `const SANDBOX_ID = ${JSON.stringify(id)};`,
      `const ZEROCLAW_HOME = ${JSON.stringify(ZEROCLAW_HOME)};`,
      `const ZEROCLAW_BIN = ${JSON.stringify(ZEROCLAW_BIN)};`,
      `const INTERVAL = ${EXTEND_INTERVAL_S} * 1000;`,
      `const CREATED_AT = Date.now();`,
      ``,
      `// Daemon housekeeping files — changes to these don't indicate user activity`,
      `const IGNORE_FILES = new Set(["daemon_state.json"]);`,
      ``,
      `function getMaxMtime(dir) {`,
      `  let max = 0;`,
      `  function walk(d) {`,
      `    try {`,
      `      for (const e of readdirSync(d, { withFileTypes: true })) {`,
      `        if (IGNORE_FILES.has(e.name)) continue;`,
      `        const p = join(d, e.name);`,
      `        if (e.isDirectory()) walk(p);`,
      `        else try { const m = statSync(p).mtimeMs; if (m > max) max = m; } catch {}`,
      `      }`,
      `    } catch {}`,
      `  }`,
      `  walk(dir);`,
      `  return max;`,
      `}`,
      ``,
      `function getCronInfo() {`,
      `  try {`,
      `    const raw = execSync(ZEROCLAW_BIN + " cron list", {`,
      `      env: process.env,`,
      `      timeout: 5000, stdio: ["pipe", "pipe", "pipe"],`,
      `    }).toString();`,
      `    const matches = [...raw.matchAll(/next=([\\d-]+T[\\d:.+Z]+)/g)];`,
      `    const times = matches.map(m => new Date(m[1]).getTime()).filter(t => !isNaN(t));`,
      `    return {`,
      `      nextCronAt: times.length ? new Date(Math.min(...times)).toISOString() : null,`,
      `      cronJobCount: matches.length,`,
      `    };`,
      `  } catch { return { nextCronAt: null, cronJobCount: 0 }; }`,
      `}`,
      ``,
      `// Track when files last changed. Starts at "now" so the sandbox gets`,
      `// a full ACTIVE_DURATION grace period before any idle-stop decision.`,
      `let lastMtime = 0;`,
      `let lastChangedAt = Date.now();`,
      ``,
      `async function tick() {`,
      `  const currMtime = getMaxMtime(ZEROCLAW_HOME);`,
      `  if (currMtime !== lastMtime) {`,
      `    lastChangedAt = Date.now();`,
      `    lastMtime = currMtime;`,
      `  }`,
      `  const cron = getCronInfo();`,
      `  try {`,
      `    const res = await fetch(URL, {`,
      `      method: "POST",`,
      `      headers: { "Authorization": "Bearer " + SECRET, "Content-Type": "application/json" },`,
      `      body: JSON.stringify({ sandboxId: SANDBOX_ID, lastChangedAt, nextCronAt: cron.nextCronAt, cronJobCount: cron.cronJobCount, sandboxCreatedAt: CREATED_AT }),`,
      `    });`,
      `    console.log("[extend-loop]", await res.text());`,
      `  } catch (err) { console.error("[extend-loop]", err.message); }`,
      `}`,
      ``,
      `tick();`,
      `setInterval(tick, INTERVAL);`,
    ].join("\n");

    const scriptPath = "/tmp/cloudclaw-extend-loop.mjs";

    try {
      await sandbox.writeFiles([
        { path: scriptPath, content: Buffer.from(script) },
      ]);
      await sandbox.runCommand({
        cmd: "node",
        args: [scriptPath],
        env: { HOME: "/tmp", ZEROCLAW_WORKSPACE },
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
    const configPath = `${ZEROCLAW_HOME}/config.toml`;

    // Step 1: Run onboard to generate a valid base config with all required fields
    if (this.adapter.onboardCommand) {
      const onboard = this.adapter.onboardCommand(env);
      const onboardEnv = {
        ...onboard.env,
        ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
        ZEROCLAW_WORKSPACE,
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
      // Raise rate limit — default 20/hr is too low for cron-heavy workloads
      "s/max_actions_per_hour = 20/max_actions_per_hour = 1000/",
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

    await sandbox.runCommand({
      cmd: command.cmd,
      args: command.args,
      env: {
        ...command.env,
        ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
        ZEROCLAW_WORKSPACE,
      },
      detached: true,
    });

    // Wait for daemon to initialize
    await new Promise((resolve) => setTimeout(resolve, DAEMON_INIT_WAIT_MS));

    // Verify daemon is running
    try {
      const ps = await sandbox.runCommand("sh", ["-c", "ps aux | grep 'zeroclaw daemon' | grep -v grep"]);
      const psOut = await ps.stdout();
      if (psOut.trim()) {
        console.log(`[CloudClaw] Daemon started (PID ${psOut.trim().split(/\s+/)[1]})`);
      } else {
        console.error("[CloudClaw] WARNING: Daemon process not found after start");
      }
    } catch {
      // best-effort check
    }
  }
}

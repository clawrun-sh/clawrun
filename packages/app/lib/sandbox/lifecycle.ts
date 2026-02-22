import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { SandboxProvider, ManagedSandbox, SandboxInfo } from "@cloudclaw/provider";
import { CountBasedRetention } from "@cloudclaw/provider";
import { VercelSandboxProvider } from "@cloudclaw/provider/vercel";
import { ZEROCLAW_HOME } from "zeroclaw/adapter";
import type { AgentAdapter, AgentEnv, ChannelConfig } from "zeroclaw/adapter";
import { getAgent } from "../agents/registry";
import { registerTelegramWakeWebhook, deleteTelegramWakeWebhook } from "../channels/telegram-wake";
import { getStateStore } from "../storage/state";
import { tryAcquireCreationLock, releaseCreationLock } from "../sandbox/lock";
import type { StateStore } from "../storage/state-types";
import type { ExtendReason } from "./extend-reasons";
import { GracePeriodReason, FileActivityReason, CronScheduleReason } from "./extend-reasons";

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

// How far ahead of a scheduled cron job to wake the sandbox (seconds).
// The sandbox needs time to boot + daemon init before the job fires.
const CRON_WAKE_LEAD_S = 60;

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

// Only extend when the native TTL is within this buffer of expiring.
// ~5 ticks of runway (at 60s intervals) before the sandbox would die.
const TTL_BUFFER_MS = 5 * 60 * 1000;

/** Active duration: grace period before idle-stop decisions + idle threshold. */
function getActiveDurationMs(): number {
  const minutes = parseInt(process.env.CLOUDCLAW_SANDBOX_ACTIVE_DURATION ?? "10", 10);
  return (minutes > 0 ? minutes : 10) * 60 * 1000;
}

export interface SandboxResult {
  status: "running" | "stopped" | "failed";
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
  const configJson = process.env.CLOUDCLAW_AGENT_CONFIG_JSON ?? "{}";
  const llmProvider = process.env.CLOUDCLAW_LLM_PROVIDER ?? "anthropic";
  const llmApiKey = process.env.CLOUDCLAW_LLM_API_KEY;
  const llmModel = process.env.CLOUDCLAW_LLM_MODEL ?? "claude-sonnet-4-20250514";

  if (!llmApiKey) {
    throw new Error("CLOUDCLAW_LLM_API_KEY environment variable is required");
  }

  return { configJson, llmProvider, llmApiKey, llmModel };
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
  private state: StateStore = (() => {
    const s = getStateStore();
    if (!s) throw new Error("State store unavailable — KV is required");
    return s;
  })();
  private provider: SandboxProvider = new VercelSandboxProvider();
  private retention = new CountBasedRetention(3);
  private extendReasons: ExtendReason[] = [
    new GracePeriodReason(getActiveDurationMs()),
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
   * Snapshot a running sandbox and stop it. Retries up to 3 times on failure.
   * Throws if all attempts fail — callers must handle this to avoid data loss
   * (stopping a sandbox without a snapshot destroys its state).
   */
  private async snapshotAndStop(
    sandboxId: string,
    retries = 3,
    retryDelayMs = 2_000,
  ): Promise<string | null> {
    const sandbox = await this.provider.get(sandboxId);
    if (sandbox.status !== "running") return null;

    let lastErr: unknown;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`[CloudClaw] Snapshotting sandbox ${sandboxId} (attempt ${attempt}/${retries})`);
        const snapshot = await sandbox.snapshot();
        console.log(`[CloudClaw] Snapshot created: ${snapshot.id}`);
        await this.applyRetention();
        return snapshot.id;
      } catch (err) {
        lastErr = err;
        console.error(`[CloudClaw] Snapshot attempt ${attempt} failed:`, err);
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, retryDelayMs));
        }
      }
    }

    // All retries exhausted — do NOT stop the sandbox. Let it keep running
    // so state is preserved. Caller must handle the error.
    throw new Error(
      `Snapshot failed after ${retries} attempts for sandbox ${sandboxId}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    );
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

  /** Tear down wake hooks — sandbox is running, daemon handles channels directly. */
  private async teardownWakeHooks(): Promise<void> {
    if (process.env.CLOUDCLAW_TELEGRAM_BOT_TOKEN) {
      await deleteTelegramWakeWebhook();
    }
    // if (process.env.CLOUDCLAW_DISCORD_BOT_TOKEN) await deleteDiscordWakeHook();
    // if (process.env.CLOUDCLAW_SLACK_BOT_TOKEN)   await deleteSlackWakeHook();
  }

  async heartbeat(): Promise<SandboxResult> {
    const sandboxes = await this.listSandboxes();
    const now = Date.now();

    // Find all non-terminal sandboxes
    const active = sandboxes.filter((s) => !this.isTerminal(s));

    // RUNNING SANDBOX: extend loop owns keep-alive decisions
    if (active.length > 0) {
      const newest = [...active].sort((a, b) => b.createdAt - a.createdAt)[0];
      console.log(
        `[CloudClaw] Heartbeat: action=none, reason=sandbox running` +
        ` (${newest.id}, ${newest.status})`,
      );
      return { status: "running", sandboxId: newest.id };
    }

    // NO SANDBOX: decide whether to wake
    const nextWakeAtStr = await this.state.get(STATE_NEXT_WAKE_AT);

    // Check for cron-triggered wake — wake CRON_WAKE_LEAD_S early so the
    // sandbox is booted and the daemon is ready before the job fires.
    if (nextWakeAtStr) {
      const nextWakeAt = new Date(nextWakeAtStr);
      const wakeDeadline = nextWakeAt.getTime() - CRON_WAKE_LEAD_S * 1000;
      const secsUntilCron = Math.round((nextWakeAt.getTime() - now) / 1000);

      if (now >= wakeDeadline) {
        console.log(
          `[CloudClaw] Heartbeat: action=wake, reason=cron due` +
          ` (nextCronAt=${nextWakeAtStr}, in ${secsUntilCron}s,` +
          ` lead=${CRON_WAKE_LEAD_S}s)`,
        );
        await this.state.delete(STATE_NEXT_WAKE_AT);
        return this.startNew(sandboxes);
      }

      // Not yet time — log and fall through to sleeping
      console.log(
        `[CloudClaw] Heartbeat: action=none, reason=sleeping` +
        ` (nextCronAt=${nextWakeAtStr}, in ${secsUntilCron}s)`,
      );
    } else {
      // First boot: no sandbox has ever existed
      const hasEverRun = sandboxes.some((s) => s.stoppedAt || s.status === "running");
      if (!hasEverRun && sandboxes.length === 0) {
        console.log("[CloudClaw] Heartbeat: action=wake, reason=first boot");
        return this.startNew(sandboxes);
      }

      console.log(
        `[CloudClaw] Heartbeat: action=none, reason=sleeping (no cron scheduled)`,
      );
    }

    // Sleeping — register wake hooks as crash recovery safety net
    await this.registerWakeHooks();

    const lastStopped = sandboxes
      .filter((s) => s.stoppedAt)
      .sort((a, b) => (b.stoppedAt ?? 0) - (a.stoppedAt ?? 0))[0];

    return {
      status: "stopped",
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
  async wake(): Promise<SandboxResult> {
    const sandboxes = await this.listSandboxes();
    const active = sandboxes.filter((s) => !this.isTerminal(s));

    if (active.length > 0) {
      const newest = [...active].sort((a, b) => b.createdAt - a.createdAt)[0];
      return { status: "running", sandboxId: newest.id };
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

    // Persist next_wake_at on every tick that reports a cron schedule.
    // This ensures the heartbeat knows when to wake the sandbox even if
    // it crashes or its native TTL expires without a graceful stop.
    if (payload.nextCronAt) {
      try {
        await this.state.set(STATE_NEXT_WAKE_AT, payload.nextCronAt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[CloudClaw] Failed to store next_wake_at:", msg);
        return { action: "error", error: `Failed to persist next_wake_at: ${msg}` };
      }
    }

    // Evaluate extend reasons (first match wins)
    let reason: string | null = null;
    for (const r of this.extendReasons) {
      reason = r.evaluate(payload, now);
      if (reason) break;
    }

    if (reason) {
      const deadline = sandbox.createdAt + sandbox.timeout;
      const remaining = deadline - now;

      if (remaining < TTL_BUFFER_MS) {
        try {
          await sandbox.extendTimeout(EXTEND_DURATION_MS);
          console.log(
            `[CloudClaw] Extended TTL (+${EXTEND_DURATION_MS / 1000}s, reason: ${reason},` +
            ` remaining was ${Math.round(remaining / 1000)}s)`,
          );
          return { action: "extended" };
        } catch (err) {
          // Extension failed (plan ceiling, API error) — fall through to
          // graceful stop instead of leaving sandbox in limbo
          console.error("[CloudClaw] extendTimeout failed, stopping gracefully:", err);
        }
      } else {
        console.log(
          `[CloudClaw] Skipping extend (reason: ${reason},` +
          ` TTL ok: ${Math.round(remaining / 1000)}s remaining)`,
        );
        return { action: "extended" };
      }
    }

    // No reason to extend (or extend failed) → snapshot + stop
    console.log(`[CloudClaw] No activity, stopping sandbox ${payload.sandboxId}`);
    try {
      await this.snapshotAndStop(payload.sandboxId);
    } catch (err) {
      // Snapshot failed — sandbox is still running. Don't stop it.
      // Extend loop will retry on the next tick.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CloudClaw] Cannot stop sandbox (snapshot failed): ${msg}`);
      return { action: "error", error: `Snapshot failed, sandbox kept running: ${msg}` };
    }

    // Only register wake hooks if no new sandbox was created during our stop.
    // Avoids re-registering a webhook that a concurrent startNew() already tore down.
    const freshActive = (await this.listSandboxes()).filter(s => !this.isTerminal(s));
    if (freshActive.length === 0) {
      await this.registerWakeHooks();
    }

    return { action: "stopped", nextWakeAt: payload.nextCronAt ?? undefined };
  }

  async forceRestart(): Promise<SandboxResult> {
    const nonce = await tryAcquireCreationLock();
    if (!nonce) {
      return { status: "failed", error: "Could not acquire lock for restart" };
    }

    try {
      const sandboxes = await this.listSandboxes();
      const active = sandboxes.filter((s) => !this.isTerminal(s));

      if (active.length > 0) {
        // Snapshot the newest to preserve state, hard-stop any extras
        const sorted = [...active].sort((a, b) => b.createdAt - a.createdAt);
        try {
          await this.snapshotAndStop(sorted[0].id);
        } catch (err) {
          // Snapshot failed — sandbox is still running. Don't proceed with
          // creating a new one — that would leave orphaned sandboxes and the
          // old state is not preserved.
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[CloudClaw] Force restart aborted (snapshot failed): ${msg}`);
          return { status: "failed", error: `Snapshot failed, sandbox kept running: ${msg}` };
        }
        if (sorted.length > 1) {
          await this.stopSandboxes(sorted.slice(1));
        }
      }

      return await this.startNewLocked(sandboxes);
    } finally {
      await releaseCreationLock(nonce);
    }
  }

  /**
   * Gracefully stop the running sandbox — snapshot first, then stop.
   * Registers wake hooks so the sandbox can be woken by a message or cron.
   */
  async gracefulStop(): Promise<SandboxResult> {
    const sandboxes = await this.listSandboxes();
    const active = sandboxes.filter((s) => !this.isTerminal(s));

    if (active.length === 0) {
      return { status: "stopped" };
    }

    const newest = [...active].sort((a, b) => b.createdAt - a.createdAt)[0];
    try {
      await this.snapshotAndStop(newest.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CloudClaw] Graceful stop failed (snapshot failed): ${msg}`);
      return { status: "failed", error: `Snapshot failed, sandbox kept running: ${msg}` };
    }

    // Stop any extras
    const extras = active.filter((s) => s.id !== newest.id);
    if (extras.length > 0) {
      await this.stopSandboxes(extras);
    }

    await this.registerWakeHooks();

    return { status: "stopped", sandboxId: newest.id };
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
  ): Promise<SandboxResult> {
    const nonce = await tryAcquireCreationLock();
    if (!nonce) {
      // Another caller is creating — wait briefly and re-check
      await new Promise((r) => setTimeout(r, 5_000));
      const fresh = await this.listSandboxes();
      const active = fresh.filter((s) => !this.isTerminal(s));
      if (active.length > 0) {
        const newest = [...active].sort((a, b) => b.createdAt - a.createdAt)[0];
        return { status: "running", sandboxId: newest.id };
      }
      return { status: "failed", error: "Could not acquire creation lock" };
    }

    try {
      return await this.startNewLocked(_sandboxes);
    } finally {
      await releaseCreationLock(nonce);
    }
  }

  private async startNewLocked(
    _sandboxes: SandboxInfo[],
  ): Promise<SandboxResult> {
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
      await this.teardownWakeHooks();
      await this.startSandboxExtendLoop(sandbox);

      return { status: "running", sandboxId: sandbox.id };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { status: "failed", error };
    }
  }

  /**
   * Start a background reporter inside the sandbox that calls the parent's
   * /api/v1/sandbox/heartbeat endpoint every 60s with filesystem mtime data
   * and next cron schedule. The parent decides whether to extend or stop.
   */
  private async startSandboxExtendLoop(sandbox: ManagedSandbox): Promise<void> {
    const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    const secret = process.env.CRON_SECRET ?? process.env.CLOUDCLAW_CRON_SECRET;
    if (!host || !secret) {
      console.log(`[CloudClaw] Cannot start extend loop — host=${host ?? "UNSET"}, secret=${secret ? "set" : "UNSET"}`);
      return;
    }

    const url = `https://${host}/api/v1/sandbox/heartbeat`;
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

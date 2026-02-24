import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { SandboxProvider, ManagedSandbox, SandboxInfo } from "@cloudclaw/provider";
import { CountBasedRetention } from "@cloudclaw/provider";
import { VercelSandboxProvider } from "@cloudclaw/provider/vercel";
import type { Agent, CronInfo } from "@cloudclaw/agent";
import { getAgent } from "../agents/registry";
import { getRuntimeConfig } from "../cloudclaw-config";
import { registerWakeHooks as registerAllWakeHooks, teardownWakeHooks as teardownAllWakeHooks } from "@cloudclaw/channel";
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

// Only extend when the native TTL is within this buffer of expiring.
// ~5 ticks of runway (at 60s intervals) before the sandbox would die.
const TTL_BUFFER_MS = 5 * 60 * 1000;

// --- State keys ---

const STATE_NEXT_WAKE_AT = "next_wake_at";

/** Active duration in ms, from cloudclaw.json (default 600s). */
function getActiveDurationMs(): number {
  return getRuntimeConfig().sandbox.activeDuration * 1000;
}

/** Cron keep-alive window in ms, from cloudclaw.json (default 900s). */
function getCronKeepAliveWindowMs(): number {
  return getRuntimeConfig().sandbox.cronKeepAliveWindow * 1000;
}

/** Cron wake lead time in seconds, from cloudclaw.json (default 60s). */
function getCronWakeLeadS(): number {
  return getRuntimeConfig().sandbox.cronWakeLeadTime;
}

function getDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
}

/** Read the agent .secret_key bundled at agent/.secret_key. */
function readBundledSecretKey(): string {
  return readFileSync(join(process.cwd(), "agent", ".secret_key"), "utf-8").trim();
}

/** Read the cloudclaw.json content for writing into the sandbox. */
function readBundledCloudclawJson(): string {
  return readFileSync(join(process.cwd(), "cloudclaw.json"), "utf-8");
}

export interface SandboxResult {
  status: "running" | "stopped" | "failed";
  sandboxId?: string;
  error?: string;
  nextWakeAt?: string;
}

export interface ExtendPayload {
  sandboxId: string;
  /** Epoch ms of the last observed file change in the agent workspace. */
  lastChangedAt: number;
  /** Epoch ms when the extend loop started (approx sandbox creation time). */
  sandboxCreatedAt?: number;
  /** Workspace root inside the sandbox. */
  root: string;
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

export class SandboxLifecycleManager {
  private agent: Agent = getAgent();
  private state: StateStore = (() => {
    const s = getStateStore();
    if (!s) throw new Error("State store unavailable — KV is required");
    return s;
  })();
  private provider: SandboxProvider = new VercelSandboxProvider();
  private retention = new CountBasedRetention(3);

  private get extendReasons(): ExtendReason[] {
    return [
      new GracePeriodReason(getActiveDurationMs()),
      new FileActivityReason(getActiveDurationMs()),
      new CronScheduleReason(getCronKeepAliveWindowMs()),
    ];
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
    const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    if (!host) {
      console.warn("[CloudClaw] VERCEL_PROJECT_PRODUCTION_URL not set — skipping wake hook registration");
      return;
    }
    await registerAllWakeHooks(`https://${host}`);
  }

  /** Tear down wake hooks — sandbox is running, daemon handles channels directly. */
  private async teardownWakeHooks(): Promise<void> {
    await teardownAllWakeHooks();
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
    const cronWakeLeadS = getCronWakeLeadS();

    // Check for cron-triggered wake — wake CRON_WAKE_LEAD_S early so the
    // sandbox is booted and the daemon is ready before the job fires.
    if (nextWakeAtStr) {
      const nextWakeAt = new Date(nextWakeAtStr);
      const wakeDeadline = nextWakeAt.getTime() - cronWakeLeadS * 1000;
      const secsUntilCron = Math.round((nextWakeAt.getTime() - now) / 1000);

      if (now >= wakeDeadline) {
        console.log(
          `[CloudClaw] Heartbeat: action=wake, reason=cron due` +
          ` (nextCronAt=${nextWakeAtStr}, in ${secsUntilCron}s,` +
          ` lead=${cronWakeLeadS}s)`,
        );
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
   * reports filesystem mtime data. The lifecycle manager queries the agent
   * for cron info and decides whether to extend or snapshot+stop.
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

    // Get cron info from agent (server-side)
    let cronInfo: CronInfo = { jobs: [] };
    try {
      cronInfo = await this.agent.getCrons(sandbox, payload.root);
    } catch (err) {
      console.error("[CloudClaw] getCrons failed:", err);
    }

    // Compute nextCronAt from jobs
    const futureTimes = cronInfo.jobs
      .map((j) => new Date(j.nextRunAt).getTime())
      .filter((t) => !isNaN(t) && t > now);
    const nextCronAt = futureTimes.length > 0
      ? new Date(Math.min(...futureTimes)).toISOString()
      : null;

    console.log(
      `[CloudClaw] Extend: sandbox=${payload.sandboxId},` +
      ` idle=${Math.round(idleMs / 1000)}s (threshold=${activeDurationMs / 1000}s),` +
      ` nextCronAt=${nextCronAt ?? "none"},` +
      ` cronJobs=${cronInfo.jobs.length}`,
    );

    // Persist next_wake_at on every tick that reports a cron schedule.
    if (nextCronAt) {
      try {
        await this.state.set(STATE_NEXT_WAKE_AT, nextCronAt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[CloudClaw] Failed to store next_wake_at:", msg);
        return { action: "error", error: `Failed to persist next_wake_at: ${msg}` };
      }
    } else {
      // No future crons — clear any stale wake time.
      try { await this.state.delete(STATE_NEXT_WAKE_AT); } catch {}
    }

    // Evaluate extend reasons (first match wins)
    const reasons = this.extendReasons;
    let reason: string | null = null;
    for (const r of reasons) {
      reason = r.evaluate(payload, now, cronInfo);
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
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CloudClaw] Cannot stop sandbox (snapshot failed): ${msg}`);
      return { action: "error", error: `Snapshot failed, sandbox kept running: ${msg}` };
    }

    // Only register wake hooks if no new sandbox was created during our stop.
    const freshActive = (await this.listSandboxes()).filter(s => !this.isTerminal(s));
    if (freshActive.length === 0) {
      await this.registerWakeHooks();
    }

    return { action: "stopped", nextWakeAt: nextCronAt ?? undefined };
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
        const sorted = [...active].sort((a, b) => b.createdAt - a.createdAt);
        try {
          await this.snapshotAndStop(sorted[0].id);
        } catch (err) {
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

      // 2. Fresh sandbox
      if (!sandbox) {
        sandbox = await this.provider.create({
          timeout: getActiveDurationMs() * NATIVE_TTL_MULTIPLIER,
          ports: [3000],
        });
      }

      // Resolve workspace root from sandbox HOME
      const homeResult = await sandbox.runCommand("sh", ["-c", "echo $HOME"]);
      const home = (await homeResult.stdout()).trim() || "/home/vercel-sandbox";
      const root = `${home}/.cloudclaw`;

      // Write cloudclaw.json into the sandbox workspace
      const cloudclawJson = readBundledCloudclawJson();
      await sandbox.runCommand("mkdir", ["-p", root]);
      await sandbox.writeFiles([
        { path: `${root}/cloudclaw.json`, content: Buffer.from(cloudclawJson) },
      ]);

      // Provision agent (binary, config, secret key, .profile)
      const localAgentDir = join(process.cwd(), "agent");
      const secretKey = readBundledSecretKey();
      await this.agent.provision(sandbox, root, { localAgentDir, secretKey });

      const databaseUrl = getDatabaseUrl();
      await this.agent.startDaemon(sandbox, root, {
        env: databaseUrl ? { DATABASE_URL: databaseUrl } : undefined,
      });
      await this.teardownWakeHooks();
      await this.startSandboxExtendLoop(sandbox, root);

      return { status: "running", sandboxId: sandbox.id };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { status: "failed", error };
    }
  }

  /**
   * Start a background reporter inside the sandbox that calls the parent's
   * /api/v1/sandbox/heartbeat endpoint every 60s with filesystem mtime data.
   * The parent queries cron info server-side and decides whether to extend or stop.
   */
  private async startSandboxExtendLoop(sandbox: ManagedSandbox, root: string): Promise<void> {
    const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    const secret = process.env.CLOUDCLAW_SANDBOX_SECRET;
    if (!host || !secret) {
      console.log(`[CloudClaw] Cannot start extend loop — host=${host ?? "UNSET"}, secret=${secret ? "set" : "UNSET"}`);
      return;
    }

    const url = `https://${host}/api/v1/sandbox/heartbeat`;
    const id = sandbox.id;
    const agentConfig = this.agent.getExtendLoopConfig(root);
    const scriptPath = `${root}/scripts/extend-loop.mjs`;
    const configPath = `${root}/scripts/extend-loop-config.json`;

    // Read the compiled extend-loop script.
    // Try cwd first (dev monorepo), then node_modules (deployed instance).
    const scriptCandidates = [
      join(process.cwd(), "dist", "scripts", "extend-loop.js"),
      join(process.cwd(), "node_modules", "@cloudclaw", "app", "dist", "scripts", "extend-loop.js"),
    ];
    const scriptFile = scriptCandidates.find((p) => existsSync(p));
    if (!scriptFile) {
      console.error("[CloudClaw] extend-loop.js not found at:", scriptCandidates);
      return;
    }
    const scriptContent = readFileSync(scriptFile, "utf-8");

    const loopConfig = {
      url,
      secret,
      sandboxId: id,
      monitorDir: agentConfig.monitorDir,
      root,
      intervalMs: EXTEND_INTERVAL_S * 1000,
      ignoreFiles: agentConfig.ignoreFiles,
    };

    try {
      await sandbox.runCommand("mkdir", ["-p", `${root}/scripts`]);
      await sandbox.writeFiles([
        { path: scriptPath, content: Buffer.from(scriptContent) },
        { path: configPath, content: Buffer.from(JSON.stringify(loopConfig)) },
      ]);

      await sandbox.runCommand({
        cmd: "node",
        args: [scriptPath, configPath],
        detached: true,
      });
      console.log(`[CloudClaw] Extend loop started for sandbox ${id}, url=${url}`);
    } catch (err) {
      console.error("[CloudClaw] Failed to start extend loop:", err);
    }
  }
}

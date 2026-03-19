import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  SandboxProvider,
  ManagedSandbox,
  SandboxInfo,
  SandboxId,
  SnapshotId,
} from "@clawrun/provider";
import { CountBasedRetention, getProvider, ACTIVE_SANDBOX_STATUSES } from "@clawrun/provider";
import type { Agent, CronJob } from "@clawrun/agent";
import { getAgent } from "../agents/registry.js";
import { getRuntimeConfig } from "../config.js";
import { getStateStore } from "../storage/state.js";
import { tryAcquireCreationLock, releaseCreationLock } from "./lock.js";
import type { StateStore } from "../storage/state-types.js";
import type { ExtendReason } from "./extend-reasons.js";
import { GracePeriodReason, FileActivityReason, CronScheduleReason } from "./extend-reasons.js";
import { createLogger } from "@clawrun/logger";
import type { SidecarConfig } from "../sidecar/types.js";
import { resolveRoot } from "./resolve-root.js";

const log = createLogger("sandbox");

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

// Sidecar health port — exposed alongside the agent daemon port
const SIDECAR_HEALTH_PORT = 3001;

// Sidecar health check retries during startup verification
const SIDECAR_HEALTH_RETRIES = 15;
const SIDECAR_HEALTH_RETRY_MS = 1000;

// Daemon ready timeout (ms) — after this delay the supervisor logs a warning
// while continuing to probe the daemon port. Not a hard deadline.
const DAEMON_READY_TIMEOUT_MS = 3000;

// --- State keys ---

const STATE_NEXT_WAKE_AT = "next_wake_at";

/** Active duration in ms, from clawrun.json (default 600s). */
function getActiveDurationMs(): number {
  return getRuntimeConfig().sandbox.activeDuration * 1000;
}

/** Cron keep-alive window in ms, from clawrun.json (default 900s). */
function getCronKeepAliveWindowMs(): number {
  return getRuntimeConfig().sandbox.cronKeepAliveWindow * 1000;
}

/** Cron wake lead time in seconds, from clawrun.json (default 60s). */
function getCronWakeLeadS(): number {
  return getRuntimeConfig().sandbox.cronWakeLeadTime;
}

/** Read the agent .secret_key bundled at agent/.secret_key. */
function readBundledSecretKey(): string {
  return readFileSync(join(process.cwd(), "agent", ".secret_key"), "utf-8").trim();
}

/** Read the clawrun.json content for writing into the sandbox. */
function readBundledClawrunJson(): string {
  return readFileSync(join(process.cwd(), "clawrun.json"), "utf-8");
}

export interface SandboxResult {
  status: "running" | "stopped" | "failed";
  sandboxId?: SandboxId;
  error?: string;
  nextWakeAt?: string;
}

export interface ExtendPayload {
  sandboxId: SandboxId;
  /** Epoch ms of the last observed file change in the agent workspace. */
  lastChangedAt: number;
  /** Epoch ms when the extend loop started (approx sandbox creation time). */
  sandboxCreatedAt?: number;
  /** Workspace root inside the sandbox. */
  root: string;
  /** Daemon status reported by sidecar supervisor. */
  daemonStatus?: string;
  /** Number of daemon restarts since last stable reset. */
  daemonRestarts?: number;
}

export interface ExtendResult {
  action: "extended" | "stopped" | "error";
  error?: string;
  nextWakeAt?: string;
  /** Human-readable reason for the action (e.g. "active (idle 45s)"). */
  reason?: string;
  /** Seconds the sandbox has been idle (no file changes). */
  idleSeconds?: number;
  /** Seconds of TTL remaining after extension. */
  remainingSeconds?: number;
}

export interface SandboxStatus {
  running: boolean;
  sandboxId?: SandboxId;
  status?: string;
  startedAt?: Date;
}

export interface LifecycleHooks {
  onSandboxStarted?: () => Promise<void>;
  onSandboxStopped?: (baseUrl: string | undefined) => Promise<void>;
}

export class SandboxLifecycleManager {
  private static hooks: LifecycleHooks = {};

  static setHooks(hooks: LifecycleHooks): void {
    SandboxLifecycleManager.hooks = hooks;
  }

  private agent: Agent = getAgent();
  private state: StateStore = (() => {
    const s = getStateStore();
    if (!s) throw new Error("State store unavailable — KV is required");
    return s;
  })();
  private provider: SandboxProvider = getProvider(getRuntimeConfig().instance.provider);
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

  private isActive(s: SandboxInfo): boolean {
    return ACTIVE_SANDBOX_STATUSES.has(s.status);
  }

  /** Stop the given sandboxes. Re-fetches each to get current status. */
  private async stopSandboxes(toStop: SandboxInfo[]): Promise<void> {
    for (const s of toStop) {
      try {
        const sandbox = await this.provider.get(s.id);
        const current = sandbox.status;

        // Only stop if actually stoppable
        if (current === "running" || current === "pending") {
          log.info(`Stopping sandbox ${s.id} (status: ${current})`);
          await sandbox.stop();
          log.info(`Stopped sandbox ${s.id}`);
        } else {
          log.info(`Skipping sandbox ${s.id} (status: ${current}, not stoppable)`);
        }
      } catch (err) {
        log.error(`Failed to stop sandbox ${s.id}:`, err);
      }
    }
  }

  /**
   * Snapshot a running sandbox and stop it. Retries up to 3 times on failure.
   * Throws if all attempts fail — callers must handle this to avoid data loss
   * (stopping a sandbox without a snapshot destroys its state).
   */
  private async snapshotAndStop(
    sandboxId: SandboxId,
    retries = 3,
    retryDelayMs = 2_000,
  ): Promise<string | null> {
    const sandbox = await this.provider.get(sandboxId);
    if (sandbox.status !== "running") return null;

    let lastErr: unknown;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        log.info(`Snapshotting sandbox ${sandboxId} (attempt ${attempt}/${retries})`);
        const snapshot = await sandbox.snapshot();
        log.info(`Snapshot created: ${snapshot.id}`);
        await this.applyRetention();
        return snapshot.id;
      } catch (err) {
        lastErr = err;
        log.error(`Snapshot attempt ${attempt} failed:`, err);
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, retryDelayMs));
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
        log.info(`Deleted old snapshot: ${id}`);
      }
    } catch (err) {
      log.error("Snapshot retention cleanup failed:", err);
    }
  }

  /**
   * Register channel wake hooks so the sandbox can be woken by messages.
   * Throws if baseUrl is not configured or hooks are not initialized.
   */
  private async registerWakeHooks(): Promise<void> {
    const baseUrl = getRuntimeConfig().instance.baseUrl;
    if (!SandboxLifecycleManager.hooks.onSandboxStopped) {
      throw new Error(
        "Cannot register wake hooks: lifecycle hooks not initialized." +
          " Ensure setupLifecycleHooks() is called during server startup.",
      );
    }
    await SandboxLifecycleManager.hooks.onSandboxStopped(baseUrl);
    log.info(`Wake hooks registered (baseUrl=${baseUrl})`);
  }

  /**
   * Tear down channel wake hooks when sandbox starts.
   * Throws if hooks are not initialized.
   */
  async teardownWakeHooks(): Promise<void> {
    if (!SandboxLifecycleManager.hooks.onSandboxStarted) {
      throw new Error(
        "Cannot tear down wake hooks: lifecycle hooks not initialized." +
          " Ensure setupLifecycleHooks() is called during server startup.",
      );
    }
    await SandboxLifecycleManager.hooks.onSandboxStarted();
    log.info("Wake hooks torn down");
  }

  async heartbeat(): Promise<SandboxResult> {
    const sandboxes = await this.listSandboxes();
    const now = Date.now();

    // Find all non-terminal sandboxes
    const active = sandboxes.filter((s) => this.isActive(s));

    // RUNNING SANDBOX: extend loop owns keep-alive decisions
    if (active.length > 0) {
      const newest = [...active].sort((a, b) => b.createdAt - a.createdAt)[0];
      log.info(
        `Heartbeat: action=none, reason=sandbox running` + ` (${newest.id}, ${newest.status})`,
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
        log.info(
          `Heartbeat: action=wake, reason=cron due` +
            ` (nextCronAt=${nextWakeAtStr}, in ${secsUntilCron}s,` +
            ` lead=${cronWakeLeadS}s)`,
        );
        return this.startNew();
      }

      // Not yet time — log and fall through to sleeping
      log.info(
        `Heartbeat: action=none, reason=sleeping` +
          ` (nextCronAt=${nextWakeAtStr}, in ${secsUntilCron}s)`,
      );
    } else {
      // First boot: no sandbox has ever existed
      const hasEverRun = sandboxes.some((s) => s.stoppedAt || s.status === "running");
      if (!hasEverRun && sandboxes.length === 0) {
        log.info("Heartbeat: action=wake, reason=first boot");
        return this.startNew();
      }

      log.info(`Heartbeat: action=none, reason=sleeping (no cron scheduled)`);
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
   * Called by channel webhook handlers when a message arrives and the
   * sandbox is stopped. Unlike heartbeat(), this does NOT make keep-alive
   * or sleep decisions — it only ensures a sandbox exists.
   */
  async wake(opts?: { skipTeardownWakeHooks?: boolean }): Promise<SandboxResult> {
    const sandboxes = await this.listSandboxes();
    const active = sandboxes.filter((s) => this.isActive(s));

    if (active.length > 0) {
      const newest = [...active].sort((a, b) => b.createdAt - a.createdAt)[0];
      return { status: "running", sandboxId: newest.id };
    }

    log.info("Wake: no active sandbox, starting one");
    return this.startNew(opts);
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
      return {
        action: "error",
        error: `Cannot get sandbox: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (sandbox.status !== "running") {
      return { action: "error", error: `Sandbox not running (status: ${sandbox.status})` };
    }

    // Daemon is dead and supervisor gave up — no point extending
    if (payload.daemonStatus === "failed") {
      log.error(
        `Daemon failed in sandbox ${payload.sandboxId} (${payload.daemonRestarts} restarts), stopping`,
      );
      try {
        await this.snapshotAndStop(payload.sandboxId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { action: "error", error: `Daemon failed, snapshot failed: ${msg}` };
      }
      return { action: "stopped" };
    }

    const now = Date.now();
    const idleMs = now - payload.lastChangedAt;
    const activeDurationMs = getActiveDurationMs();

    // Get cron info from agent (server-side)
    let cronJobs: CronJob[] = [];
    try {
      cronJobs = await this.agent.listCronJobs(sandbox, payload.root);
    } catch (err) {
      log.error("listCronJobs failed:", err);
    }

    // Compute nextCronAt from jobs
    const futureTimes = cronJobs
      .map((j) => new Date(j.nextRun ?? "").getTime())
      .filter((t) => !isNaN(t) && t > now);
    const nextCronAt =
      futureTimes.length > 0 ? new Date(Math.min(...futureTimes)).toISOString() : null;

    log.info(
      `Extend: sandbox=${payload.sandboxId},` +
        ` idle=${Math.round(idleMs / 1000)}s (threshold=${activeDurationMs / 1000}s),` +
        ` nextCronAt=${nextCronAt ?? "none"},` +
        ` cronJobs=${cronJobs.length}`,
    );

    // Persist next_wake_at on every tick that reports a cron schedule.
    if (nextCronAt) {
      try {
        await this.state.set(STATE_NEXT_WAKE_AT, nextCronAt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("Failed to store next_wake_at:", msg);
        return { action: "error", error: `Failed to persist next_wake_at: ${msg}` };
      }
    } else {
      // No future crons — clear any stale wake time.
      try {
        await this.state.delete(STATE_NEXT_WAKE_AT);
      } catch {}
    }

    // Evaluate extend reasons (first match wins)
    const reasons = this.extendReasons;
    let reason: string | null = null;
    for (const r of reasons) {
      reason = r.evaluate(payload, now, cronJobs);
      if (reason) break;
    }

    const idleSeconds = Math.round((now - payload.lastChangedAt) / 1000);

    if (reason) {
      const deadline = sandbox.createdAt + sandbox.timeout;
      const remaining = deadline - now;
      const remainingSeconds = Math.round(remaining / 1000);

      if (remaining < TTL_BUFFER_MS) {
        try {
          await sandbox.extendTimeout(EXTEND_DURATION_MS);
          const newRemaining = Math.round(EXTEND_DURATION_MS / 1000);
          log.info(
            `Extended TTL (+${EXTEND_DURATION_MS / 1000}s, reason: ${reason},` +
              ` remaining was ${remainingSeconds}s)`,
          );
          return { action: "extended", reason, idleSeconds, remainingSeconds: newRemaining };
        } catch (err) {
          // Extension failed (plan ceiling, API error) — fall through to
          // graceful stop instead of leaving sandbox in limbo
          log.error("extendTimeout failed, stopping gracefully:", err);
        }
      } else {
        log.info(
          `Skipping extend (reason: ${reason},` + ` TTL ok: ${remainingSeconds}s remaining)`,
        );
        return { action: "extended", reason, idleSeconds, remainingSeconds };
      }
    }

    // No reason to extend (or extend failed) → snapshot + stop
    log.info(`No activity, stopping sandbox ${payload.sandboxId} (idle ${idleSeconds}s)`);
    try {
      await this.snapshotAndStop(payload.sandboxId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Cannot stop sandbox (snapshot failed): ${msg}`);
      return { action: "error", error: `Snapshot failed, sandbox kept running: ${msg}` };
    }

    // Register wake hooks unless a NEW sandbox was created during our stop.
    // Exclude the sandbox we just stopped — the list API may still report it
    // as "running" due to eventual consistency.
    const otherActive = (await this.listSandboxes()).filter(
      (s) => s.id !== payload.sandboxId && this.isActive(s),
    );
    if (otherActive.length === 0) {
      try {
        await this.registerWakeHooks();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`handleExtend: wake hook registration failed: ${msg}`);
        return { action: "error", error: `Sandbox stopped but wake hooks failed: ${msg}` };
      }
    } else {
      log.info(
        `Skipping wake hooks: ${otherActive.length} other active sandbox(es)` +
          ` (${otherActive.map((s) => `${s.id}:${s.status}`).join(", ")})`,
      );
    }

    return {
      action: "stopped",
      reason: `idle ${idleSeconds}s`,
      idleSeconds,
      nextWakeAt: nextCronAt ?? undefined,
    };
  }

  async forceRestart(): Promise<SandboxResult> {
    const nonce = await tryAcquireCreationLock();
    if (!nonce) {
      return { status: "failed", error: "Could not acquire lock for restart" };
    }

    try {
      const sandboxes = await this.listSandboxes();
      const active = sandboxes.filter((s) => this.isActive(s));

      if (active.length > 0) {
        const sorted = [...active].sort((a, b) => b.createdAt - a.createdAt);
        try {
          await this.snapshotAndStop(sorted[0].id);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.error(`Force restart aborted (snapshot failed): ${msg}`);
          return { status: "failed", error: `Snapshot failed, sandbox kept running: ${msg}` };
        }
        if (sorted.length > 1) {
          await this.stopSandboxes(sorted.slice(1));
        }
      }

      return await this.startNewLocked();
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
    const active = sandboxes.filter((s) => this.isActive(s));

    if (active.length === 0) {
      // No active sandbox — still register wake hooks in case the sandbox
      // was stopped externally (timeout, platform kill) without hook registration.
      try {
        await this.registerWakeHooks();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`gracefulStop: wake hook registration failed: ${msg}`);
        return { status: "stopped", error: `Sandbox already stopped. Wake hooks failed: ${msg}` };
      }
      return { status: "stopped" };
    }

    const newest = [...active].sort((a, b) => b.createdAt - a.createdAt)[0];
    try {
      await this.snapshotAndStop(newest.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Graceful stop failed (snapshot failed): ${msg}`);
      return { status: "failed", error: `Snapshot failed, sandbox kept running: ${msg}` };
    }

    // Stop any extras
    const extras = active.filter((s) => s.id !== newest.id);
    if (extras.length > 0) {
      await this.stopSandboxes(extras);
    }

    try {
      await this.registerWakeHooks();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`gracefulStop: wake hook registration failed: ${msg}`);
      return { status: "stopped", sandboxId: newest.id, error: `Wake hooks failed: ${msg}` };
    }

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
    const latest = sandboxes.sort((a, b) => b.createdAt - a.createdAt)[0];

    if (latest) {
      return {
        running: false,
        sandboxId: latest.id,
        status: latest.status,
      };
    }

    return { running: false };
  }

  private async startNew(opts?: { skipTeardownWakeHooks?: boolean }): Promise<SandboxResult> {
    const nonce = await tryAcquireCreationLock();
    if (!nonce) {
      // Another caller is creating — wait briefly and re-check
      await new Promise((r) => setTimeout(r, 5_000));
      const fresh = await this.listSandboxes();
      const active = fresh.filter((s) => this.isActive(s));
      if (active.length > 0) {
        const newest = [...active].sort((a, b) => b.createdAt - a.createdAt)[0];
        return { status: "running", sandboxId: newest.id };
      }
      return { status: "failed", error: "Could not acquire creation lock" };
    }

    try {
      return await this.startNewLocked(opts);
    } finally {
      await releaseCreationLock(nonce);
    }
  }

  private async startNewLocked(opts?: { skipTeardownWakeHooks?: boolean }): Promise<SandboxResult> {
    try {
      let sandbox: ManagedSandbox | null = null;
      let snapshotId: SnapshotId | undefined;

      const networkPolicy = getRuntimeConfig().sandbox.networkPolicy;

      // 1. Try latest snapshot from provider.
      try {
        const snapshots = await this.provider.listSnapshots();
        const latest = snapshots.sort((a, b) => b.createdAt - a.createdAt)[0];
        if (latest) {
          try {
            sandbox = await this.provider.create({
              snapshotId: latest.id,
              timeout: getActiveDurationMs() * NATIVE_TTL_MULTIPLIER,
              ports: [this.agent.daemonPort, SIDECAR_HEALTH_PORT],
              resources: { vcpus: getRuntimeConfig().sandbox.resources.vcpus },
            });
            snapshotId = latest.id;
            log.info(`Resumed from latest snapshot: ${latest.id}`);
          } catch (err) {
            log.error(`Failed to resume from snapshot ${latest.id}:`, err);
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
          ports: [this.agent.daemonPort, SIDECAR_HEALTH_PORT],
          resources: { vcpus: getRuntimeConfig().sandbox.resources.vcpus },
        });
      }

      const root = await resolveRoot(sandbox);

      // Write clawrun.json into the sandbox workspace
      const clawrunJson = readBundledClawrunJson();
      await sandbox.runCommand("mkdir", ["-p", root]);
      await sandbox.writeFiles([
        { path: `${root}/clawrun.json`, content: Buffer.from(clawrunJson) },
      ]);

      // Provision agent (binary, config, secret key, .profile).
      // When restoring from snapshot, skip workspace .md files — the snapshot
      // already contains the agent's customized versions.
      const localAgentDir = join(process.cwd(), "agent");
      const secretKey = readBundledSecretKey();
      await this.agent.provision(sandbox, root, {
        localAgentDir,
        secretKey,
        fromSnapshot: !!snapshotId,
      });

      // Apply network policy before starting services.
      if (networkPolicy !== "allow-all") {
        log.info(`Applying network policy to sandbox ${sandbox.id}`);
        await sandbox.updateNetworkPolicy(networkPolicy);
      }

      // Start sidecar (supervises daemon + heartbeat + health server)
      await this.startSidecar(sandbox, root);
      if (!opts?.skipTeardownWakeHooks) {
        await this.teardownWakeHooks();
      }

      return { status: "running", sandboxId: sandbox.id };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error(`startNewLocked failed: ${error}`);
      return { status: "failed", error };
    }
  }

  /**
   * Start the sidecar daemon inside the sandbox. The sidecar is a single
   * Node process that supervises the agent daemon, runs the heartbeat loop,
   * and exposes an HTTP health endpoint on port 3001.
   */
  private async startSidecar(sandbox: ManagedSandbox, root: string): Promise<void> {
    const baseUrl = getRuntimeConfig().instance.baseUrl;
    const secret = process.env.CLAWRUN_SANDBOX_SECRET;
    if (!secret) {
      throw new Error("Cannot start sidecar — missing: CLAWRUN_SANDBOX_SECRET");
    }

    const daemonCmd = this.agent.getDaemonCommand(root, {});
    const monitorConfig = this.agent.getMonitorConfig(root);

    // Build tool configs for sidecar (installed inside sandbox as user)
    const configuredToolIds = getRuntimeConfig().agent.tools ?? [];
    const toolConfigs =
      configuredToolIds.length > 0
        ? this.agent
            .getAvailableTools()
            .filter((t) => configuredToolIds.includes(t.id))
            .map((t) => ({
              id: t.id,
              check: t.checkCommand,
              install: t.installCommands,
              env: t.runtimeEnv,
            }))
        : [];

    const sidecarConfig: SidecarConfig = {
      daemon: {
        cmd: daemonCmd.cmd,
        args: daemonCmd.args,
        env: daemonCmd.env,
        port: this.agent.daemonPort,
        readyTimeout: DAEMON_READY_TIMEOUT_MS,
      },
      heartbeat: {
        url: `${baseUrl}/api/v1/sandbox/heartbeat`,
        sandboxId: sandbox.id,
        intervalMs: EXTEND_INTERVAL_S * 1000,
      },
      monitor: {
        dir: monitorConfig.dir,
        ignoreFiles: monitorConfig.ignoreFiles,
      },
      health: {
        port: SIDECAR_HEALTH_PORT,
      },
      tools: toolConfigs.length > 0 ? toolConfigs : undefined,
      root,
    };

    // Read the bundled sidecar script from dist/scripts/sidecar/index.js.
    // Try cwd first (dev monorepo), then node_modules (deployed instance).
    const sidecarBundleCandidates = [
      join(process.cwd(), "dist", "scripts", "sidecar", "index.js"),
      join(
        process.cwd(),
        "node_modules",
        "@clawrun",
        "runtime",
        "dist",
        "scripts",
        "sidecar",
        "index.js",
      ),
    ];
    const sidecarBundle = sidecarBundleCandidates.find((p) => existsSync(p));
    if (!sidecarBundle) {
      throw new Error(`Sidecar bundle not found. Searched: ${sidecarBundleCandidates.join(", ")}`);
    }

    const sandboxSidecarDir = `${root}/scripts/sidecar`;
    const configPath = `${root}/scripts/sidecar-config.json`;
    const entryPath = `${sandboxSidecarDir}/index.js`;

    const bundleContent = readFileSync(sidecarBundle);

    await sandbox.runCommand("mkdir", ["-p", sandboxSidecarDir]);
    await sandbox.writeFiles([
      { path: entryPath, content: bundleContent },
      { path: configPath, content: Buffer.from(JSON.stringify(sidecarConfig)) },
    ]);

    // Launch as detached. Secret passed via env option (not in cmdline, so
    // it won't appear in ps/top/htop inside the sandbox).
    // Logger writes directly to ${root}/logs/sidecar.log inside the sandbox.
    await sandbox.runCommand({
      cmd: "node",
      args: [entryPath, configPath],
      env: { CLAWRUN_HB_SECRET: secret },
      detached: true,
    });

    // Verify via HTTP health check (replaces pgrep-based verification)
    const healthUrl = sandbox.domain(SIDECAR_HEALTH_PORT) + "/health";
    let lastError: string | undefined;

    for (let i = 0; i < SIDECAR_HEALTH_RETRIES; i++) {
      await new Promise((r) => setTimeout(r, SIDECAR_HEALTH_RETRY_MS));
      try {
        const res = await fetch(healthUrl);
        if (res.ok) {
          const body = (await res.json()) as {
            daemon?: { status?: string; pid?: number; restarts?: number };
          };
          const daemonStatus = body.daemon?.status;

          if (daemonStatus === "running") {
            log.info(
              `Sidecar healthy for sandbox ${sandbox.id}` +
                ` (daemon=running, pid=${body.daemon?.pid})`,
            );
            return;
          }

          if (daemonStatus === "failed") {
            lastError = `daemon failed after ${body.daemon?.restarts ?? "?"} restarts`;
            break; // No point retrying — supervisor gave up
          }

          // Daemon still starting — keep polling
          lastError = `daemon status: ${daemonStatus ?? "unknown"}`;
        } else {
          lastError = `HTTP ${res.status}`;
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    // Health check failed — read log for diagnostics
    const logPath = `${root}/logs/sidecar.log`;
    const logBuf = await sandbox.readFile(logPath);
    const logOutput = logBuf ? logBuf.toString("utf-8").trim() : "(no log output)";
    throw new Error(
      `Sidecar health check failed for sandbox ${sandbox.id}` +
        ` after ${SIDECAR_HEALTH_RETRIES} retries (last: ${lastError}).` +
        ` Log output:\n${logOutput}`,
    );
  }
}

/**
 * Sandbox extend-loop script.
 *
 * Compiled via `tsconfig.scripts.json` to `dist/scripts/extend-loop.js`,
 * then written into the sandbox as `extend-loop.mjs` at runtime.
 *
 * Runs as a detached Node process inside the Firecracker sandbox, polling
 * the parent's heartbeat endpoint every N seconds with filesystem mtime data.
 * The parent decides whether to extend or stop the sandbox.
 *
 * Zero external dependencies — only node:fs and node:path.
 */

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ExtendLoopConfig {
  url: string;
  secret: string;
  sandboxId: string;
  monitorDir: string;
  root: string;
  intervalMs: number;
  ignoreFiles: string[];
}

export interface LoopState {
  lastMtime: number;
  lastChangedAt: number;
  createdAt: number;
}

/** Recursively scan `dir` and return the highest mtime (ms) of any file. */
export function getMaxMtime(dir: string, ignoreFiles: Set<string>): number {
  let max = 0;

  function walk(d: string): void {
    try {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (ignoreFiles.has(entry.name)) continue;
        const fullPath = join(d, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else {
          try {
            const mtime = statSync(fullPath).mtimeMs;
            if (mtime > max) max = mtime;
          } catch {
            // File may have been deleted between readdir and stat
          }
        }
      }
    } catch {
      // Directory may not exist or be unreadable
    }
  }

  walk(dir);
  return max;
}

/** One tick of the extend loop: scan mtimes and POST to the parent. */
export async function tick(config: ExtendLoopConfig, state: LoopState): Promise<void> {
  const ignoreFiles = new Set(config.ignoreFiles);
  const currMtime = getMaxMtime(config.monitorDir, ignoreFiles);

  if (currMtime !== state.lastMtime) {
    state.lastChangedAt = Date.now();
    state.lastMtime = currMtime;
  }

  try {
    const res = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + config.secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sandboxId: config.sandboxId,
        lastChangedAt: state.lastChangedAt,
        sandboxCreatedAt: state.createdAt,
        root: config.root,
      }),
    });
    console.log("[extend-loop]", await res.text());
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[extend-loop]", message);
  }
}

/** Start the extend loop: immediate first tick, then repeat on interval. */
export function startLoop(config: ExtendLoopConfig): void {
  const state: LoopState = {
    lastMtime: 0,
    lastChangedAt: Date.now(),
    createdAt: Date.now(),
  };

  tick(config, state);
  setInterval(() => tick(config, state), config.intervalMs);
}

// --- Entry point ---
// When executed directly (node extend-loop.mjs <config.json>), read config and start.
if (process.argv[1]?.endsWith("extend-loop.mjs") || process.argv[1]?.endsWith("extend-loop.js")) {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error("[extend-loop] Usage: node extend-loop.mjs <config.json>");
    process.exit(1);
  }
  const config: ExtendLoopConfig = JSON.parse(readFileSync(configPath, "utf-8"));
  startLoop(config);
}

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Recursively scan `dir` and return the highest mtime (ms) of any file. */
export function getMaxMtime(dir: string, ignoreFiles: string[]): number {
  const ignored = new Set(ignoreFiles);
  let max = 0;

  function walk(d: string): void {
    try {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (ignored.has(entry.name)) continue;
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

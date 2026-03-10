#!/usr/bin/env node

/**
 * Wrapper around the `skills` CLI that forces ClawRun-specific flags.
 * Installed to ~/.clawrun/bin/skills, which shadows the real binary
 * via PATH ordering set by the sidecar.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const HOME = process.env.HOME ?? "/root";

/** Find the real `skills` binary by scanning PATH, skipping ~/.clawrun/bin. */
function findRealSkills(): string {
  const clawrunBin = join(HOME, ".clawrun", "bin");
  const dirs = (process.env.PATH ?? "").split(":");
  for (const dir of dirs) {
    if (dir === clawrunBin) continue;
    const candidate = join(dir, "skills");
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("skills binary not found in PATH");
}

const real = findRealSkills();
const [, , subcommand, ...rest] = process.argv;

switch (subcommand) {
  case "add":
  case "install":
    execFileSync(real, ["add", ...rest, "-a", "openclaw", "-y", "--copy"], {
      stdio: "inherit",
    });
    break;
  case "remove":
    execFileSync(real, ["remove", ...rest, "-a", "openclaw", "-y"], {
      stdio: "inherit",
    });
    break;
  default:
    // All other subcommands (find, list, check, update, etc.) pass through
    execFileSync(real, [subcommand, ...rest].filter(Boolean), {
      stdio: "inherit",
    });
    break;
}

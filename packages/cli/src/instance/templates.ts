import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";

/**
 * Paths that existed in previous template versions but have since been removed.
 * Cleaned up before applying new templates so stale routes don't cause build errors.
 */
const STALE_PATHS = ["app/api/auth", "app/auth/signin", "node-stub.js", "middleware.ts"];

export function applyTemplates(instancePath: string): void {
  const templatesDir = join(instancePath, "node_modules", "@clawrun", "server", "templates");

  if (!existsSync(templatesDir)) {
    console.log(
      chalk.yellow(
        "  Warning: templates directory not found in @clawrun/server. Skipping template application.",
      ),
    );
    return;
  }

  // Remove stale template paths from previous versions
  for (const rel of STALE_PATHS) {
    const full = join(instancePath, rel);
    if (existsSync(full)) {
      rmSync(full, { recursive: true, force: true });
    }
  }

  cpSync(templatesDir, instancePath, {
    recursive: true,
    force: true,
  });

  console.log(chalk.green("  Templates applied."));
}

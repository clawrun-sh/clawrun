import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";

export function applyTemplates(instancePath: string): void {
  const templatesDir = join(instancePath, "node_modules", "@cloudclaw", "server", "templates");

  if (!existsSync(templatesDir)) {
    console.log(
      chalk.yellow(
        "  Warning: templates directory not found in @cloudclaw/server. Skipping template application.",
      ),
    );
    return;
  }

  cpSync(templatesDir, instancePath, {
    recursive: true,
    force: true,
  });

  console.log(chalk.green("  Templates applied."));
}

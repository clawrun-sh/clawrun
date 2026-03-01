import { mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { createConsola, type ConsolaInstance } from "consola";

let _logger: ConsolaInstance | undefined;

export function initLogger(root: string): void {
  const logPath = join(root, "logs", "sidecar.log");
  mkdirSync(join(root, "logs"), { recursive: true });

  _logger = createConsola({
    level: 4,
    reporters: [
      {
        log(logObj) {
          const ts = new Date().toISOString();
          const msg = logObj.args
            .map((a: unknown) => (typeof a === "string" ? a : JSON.stringify(a)))
            .join(" ");
          const line = `${ts} ${msg}\n`;
          appendFile(logPath, line).catch(() => {});
        },
      },
    ],
  });
}

export function createLogger(tag: string): ConsolaInstance {
  if (!_logger) {
    throw new Error("Logger not initialized — call initLogger(root) first");
  }
  return _logger.withTag(tag);
}

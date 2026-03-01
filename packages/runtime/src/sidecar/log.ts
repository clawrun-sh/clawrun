import { mkdirSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";

let _logger: pino.Logger | undefined;

export function initLogger(root: string): void {
  const logPath = join(root, "logs", "sidecar.log");
  mkdirSync(join(root, "logs"), { recursive: true });

  _logger = pino(pino.destination(logPath));
}

export function createLogger(tag: string): pino.Logger {
  if (!_logger) {
    throw new Error("Logger not initialized — call initLogger(root) first");
  }
  return _logger.child({ tag });
}

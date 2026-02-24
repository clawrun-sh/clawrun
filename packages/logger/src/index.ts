import { createConsola, type ConsolaInstance } from "consola";

const isProd = process.env.NODE_ENV === "production";

const rootLogger = createConsola({
  level: parseLevel(process.env.CLOUDCLAW_LOG_LEVEL) ?? (isProd ? 3 : 4),
  fancy: !isProd,
});

function parseLevel(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const map: Record<string, number> = {
    fatal: 0,
    error: 0,
    warn: 1,
    log: 2,
    info: 3,
    debug: 4,
    trace: 5,
    verbose: 5,
  };
  return map[raw.toLowerCase()];
}

export function createLogger(tag: string): ConsolaInstance {
  return rootLogger.withTag(tag);
}

export { rootLogger as logger };
export type { ConsolaInstance as Logger };

import { spawn } from "node:child_process";
import type { ToolConfig } from "./types.js";
import { createLogger } from "./log.js";

let log: ReturnType<typeof createLogger>;
function getLog() {
  if (!log) log = createLogger("tools");
  return log;
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5_000;

function run(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const home = process.env.HOME ?? "/root";
    const child = spawn(cmd, args, {
      stdio: "ignore",
      env: { ...process.env, PATH: `${home}/.local/bin:${process.env.PATH}` },
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function isInstalled(tool: ToolConfig): Promise<boolean> {
  return (await run(tool.check.cmd, tool.check.args)) === 0;
}

async function installStep(step: { cmd: string; args: string[] }): Promise<void> {
  const label = `${step.cmd} ${step.args.join(" ")}`;
  getLog().info(`running: ${label}`);
  const exitCode = await run(step.cmd, step.args);
  if (exitCode !== 0) {
    throw new Error(`${label} exited with code ${exitCode}`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function installTools(tools: ToolConfig[]): Promise<void> {
  if (tools.length === 0) return;

  getLog().info(`installing: ${tools.map((t) => t.id).join(", ")}`);

  for (const tool of tools) {
    if (await isInstalled(tool)) {
      getLog().info(`${tool.id}: already installed, skipped`);
      continue;
    }

    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        for (const step of tool.install) {
          await installStep(step);
        }
        getLog().info(`${tool.id}: installed`);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        getLog().error(`${tool.id}: attempt ${attempt}/${MAX_ATTEMPTS} failed: ${msg}`);
        if (attempt < MAX_ATTEMPTS) {
          getLog().info(`retrying in ${RETRY_DELAY_MS / 1000}s...`);
          await delay(RETRY_DELAY_MS);
        }
      }
    }

    if (lastErr) {
      getLog().error(`${tool.id}: all ${MAX_ATTEMPTS} attempts failed, continuing without it`);
    }
  }
}

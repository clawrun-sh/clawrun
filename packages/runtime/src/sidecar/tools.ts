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

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function isInstalled(tool: ToolConfig): Promise<boolean> {
  try {
    await run(tool.check.cmd, tool.check.args);
    return true;
  } catch {
    return false;
  }
}

async function installTool(tool: ToolConfig): Promise<void> {
  for (const step of tool.install) {
    getLog().info(`running: ${step.cmd} ${step.args.join(" ")}`);
    await run(step.cmd, step.args);
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
        await installTool(tool);
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
      getLog().error(`${tool.id}: all attempts failed, continuing without it`);
    }
  }
}

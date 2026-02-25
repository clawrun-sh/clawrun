import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SandboxProvider, ManagedSandbox } from "@clawrun/provider";
import { getProvider } from "@clawrun/provider";
import type { Agent, AgentResponse } from "@clawrun/agent";
import { getAgent } from "../agents/registry.js";
import { getRuntimeConfig } from "../config.js";

const SANDBOX_TIMEOUT_MS = 60_000;
const COMMAND_TIMEOUT_MS = 45_000;

/** Read the agent .secret_key bundled at agent/.secret_key. */
function readBundledSecretKey(): string {
  return readFileSync(join(process.cwd(), "agent", ".secret_key"), "utf-8").trim();
}

let _provider: SandboxProvider | null = null;
function getSandboxProvider(): SandboxProvider {
  if (!_provider) _provider = getProvider(getRuntimeConfig().instance.provider);
  return _provider;
}

function getDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
}

export async function runAgent(
  message: string,
  options?: { agentId?: string },
): Promise<AgentResponse> {
  const agent: Agent = getAgent(options?.agentId);
  let sandbox: ManagedSandbox | null = null;

  try {
    const snapshotId = process.env.CLAWRUN_SANDBOX_SNAPSHOT_ID;
    const databaseUrl = getDatabaseUrl();

    // Create sandbox
    sandbox = await getSandboxProvider().create({
      timeout: SANDBOX_TIMEOUT_MS,
      ...(snapshotId ? { snapshotId } : {}),
    });

    // Resolve workspace root from sandbox HOME
    const { sandboxRoot } = getRuntimeConfig().instance;
    const homeResult = await sandbox.runCommand("sh", ["-c", "echo ~"]);
    const home = (await homeResult.stdout()).trim();
    const root = `${home}/${sandboxRoot}`;

    // Provision agent (binary, config, secret key, .profile)
    const localAgentDir = join(process.cwd(), "agent");
    const secretKey = readBundledSecretKey();
    await agent.provision(sandbox, root, { localAgentDir, secretKey });

    // Run agent with timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), COMMAND_TIMEOUT_MS);

    try {
      return await agent.sendMessage(sandbox, root, message, {
        env: databaseUrl ? { DATABASE_URL: databaseUrl } : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err: unknown) {
    let errorMessage = err instanceof Error ? err.message : "Unknown error occurred";
    // Include API response body for sandbox errors (e.g. 400/403)
    const apiJson = (err as { json?: unknown }).json;
    if (apiJson) {
      errorMessage += ` | API response: ${JSON.stringify(apiJson)}`;
    }
    return {
      success: false,
      message: "Something went wrong while running the agent.",
      error: errorMessage,
    };
  } finally {
    if (sandbox) {
      try {
        await sandbox.stop();
      } catch {
        // Best-effort cleanup
      }
    }
  }
}

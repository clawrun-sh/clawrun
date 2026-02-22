import { readFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import type { SandboxProvider, ManagedSandbox } from "@cloudclaw/provider";
import { VercelSandboxProvider } from "@cloudclaw/provider/vercel";
import { ZEROCLAW_HOME } from "zeroclaw/adapter";
import type { AgentAdapter, AgentEnv, AgentResponse } from "zeroclaw/adapter";
import { getAgent } from "../agents/registry";

const SANDBOX_TIMEOUT_MS = 60_000;
const COMMAND_TIMEOUT_MS = 45_000;

function getAgentEnv(): AgentEnv {
  const configJson = process.env.CLOUDCLAW_AGENT_CONFIG_JSON ?? "{}";
  const llmProvider = process.env.CLOUDCLAW_LLM_PROVIDER ?? "anthropic";
  const llmApiKey = process.env.CLOUDCLAW_LLM_API_KEY;
  const llmModel = process.env.CLOUDCLAW_LLM_MODEL ?? "claude-sonnet-4-20250514";

  if (!llmApiKey) {
    throw new Error("CLOUDCLAW_LLM_API_KEY environment variable is required");
  }

  return { configJson, llmProvider, llmApiKey, llmModel };
}

function resolveAssetPath(localPath: string): string {
  return isAbsolute(localPath)
    ? localPath
    : join(process.cwd(), localPath);
}

const provider: SandboxProvider = new VercelSandboxProvider();

function getDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
}

export async function runAgent(
  message: string,
  options?: { agentId?: string },
): Promise<AgentResponse> {
  const adapter: AgentAdapter = getAgent(options?.agentId);
  let sandbox: ManagedSandbox | null = null;

  try {
    const env = getAgentEnv();
    const snapshotId = process.env.SANDBOX_SNAPSHOT_ID;
    const databaseUrl = getDatabaseUrl();

    // Create sandbox (function must be in iad1 region — see vercel.json)
    sandbox = await provider.create({
      timeout: SANDBOX_TIMEOUT_MS,
      ...(snapshotId ? { snapshotId } : {}),
    });

    // Install agent (skip if resuming from snapshot — binary already there)
    if (!snapshotId) {
      // Write binary assets into the sandbox from the function's filesystem
      const assets = adapter.binaryAssets();
      if (assets.length > 0) {
        const parentDirs = new Set(
          assets.map((a) => a.sandboxPath.substring(0, a.sandboxPath.lastIndexOf("/"))),
        );
        for (const dir of parentDirs) {
          await sandbox.runCommand("mkdir", ["-p", dir]);
        }

        await sandbox.writeFiles(
          assets.map((asset) => ({
            path: asset.sandboxPath,
            content: readFileSync(resolveAssetPath(asset.localPath)),
          })),
        );
      }

      // Run install commands (e.g. chmod +x)
      for (const installCmd of adapter.installCommands()) {
        const installResult = await sandbox.runCommand({
          cmd: installCmd.cmd,
          args: installCmd.args,
          env: installCmd.env,
        });
        if (installResult.exitCode !== 0) {
          const stderr = await installResult.stderr();
          return {
            success: false,
            message: "Failed to set up the agent environment.",
            error: `Install step failed: ${stderr}`,
          };
        }
      }

      // Run onboard command if the adapter provides one (generates config)
      if (adapter.onboardCommand) {
        const onboard = adapter.onboardCommand(env);
        const onboardEnv = {
          ...onboard.env,
          ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
        };
        const onboardResult = await sandbox.runCommand({
          cmd: onboard.cmd,
          args: onboard.args,
          env: onboardEnv,
        });
        if (onboardResult.exitCode !== 0) {
          const stderr = await onboardResult.stderr();
          return {
            success: false,
            message: "Failed to configure the agent.",
            error: `Onboard failed: ${stderr}`,
          };
        }

        // Patch autonomy: set level to "full" so memory_store and other
        // tools work in single-shot mode (no human to approve).
        await sandbox.runCommand("sed", [
          "-i",
          's/level = "supervised"/level = "full"/',
          `${ZEROCLAW_HOME}/config.toml`,
        ]);
      }
    }

    // Write config files (if adapter provides static config instead of onboard)
    const configFiles = adapter.generateConfig(env);
    if (configFiles.length > 0) {
      const dirs = new Set(
        configFiles.map((f) => f.path.substring(0, f.path.lastIndexOf("/"))),
      );
      for (const dir of dirs) {
        await sandbox.runCommand("mkdir", ["-p", dir]);
      }

      await sandbox.writeFiles(
        configFiles.map((f) => ({
          path: f.path,
          content: Buffer.from(f.content),
        })),
      );
    }

    // Run agent command with timeout
    const command = adapter.buildCommand(message);

    // Merge DATABASE_URL into command env so the agent's Postgres memory
    // backend can connect from inside the sandbox.
    const commandEnv = {
      ...command.env,
      ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
    };

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      COMMAND_TIMEOUT_MS,
    );

    let result;
    try {
      result = await sandbox.runCommand({
        cmd: command.cmd,
        args: command.args,
        env: commandEnv,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const stdout = await result.stdout();
    const stderr = await result.stderr();
    return adapter.parseResponse(stdout, stderr, result.exitCode);
  } catch (err: unknown) {
    let errorMessage =
      err instanceof Error ? err.message : "Unknown error occurred";
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

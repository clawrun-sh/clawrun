import { readFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { Sandbox } from "@vercel/sandbox";
import type { AgentAdapter, AgentEnv, AgentResponse } from "zeroclaw/adapter";
import type { ChatMessage } from "../storage/types";
import { getAgent } from "../agents/registry";

const SANDBOX_TIMEOUT_MS = 60_000;
const COMMAND_TIMEOUT_MS = 45_000;

function getAgentEnv(): AgentEnv {
  const llmProvider = process.env.CLOUDCLAW_LLM_PROVIDER ?? "anthropic";
  const llmApiKey = process.env.CLOUDCLAW_LLM_API_KEY;
  const llmModel = process.env.CLOUDCLAW_LLM_MODEL ?? "claude-sonnet-4-20250514";

  if (!llmApiKey) {
    throw new Error("CLOUDCLAW_LLM_API_KEY environment variable is required");
  }

  return { llmProvider, llmApiKey, llmModel };
}

function resolveAssetPath(localPath: string): string {
  return isAbsolute(localPath)
    ? localPath
    : join(process.cwd(), localPath);
}

export async function runAgent(
  message: string,
  options?: { agentId?: string; history?: ChatMessage[] },
): Promise<AgentResponse> {
  const adapter: AgentAdapter = getAgent(options?.agentId);
  let sandbox: Sandbox | null = null;

  try {
    const env = getAgentEnv();
    const snapshotId = process.env.SANDBOX_SNAPSHOT_ID;

    // Create sandbox (function must be in iad1 region — see vercel.json)
    sandbox = snapshotId
      ? await Sandbox.create({
          source: { type: "snapshot", snapshotId },
          timeout: SANDBOX_TIMEOUT_MS,
        })
      : await Sandbox.create({ timeout: SANDBOX_TIMEOUT_MS });

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
        const onboardResult = await sandbox.runCommand({
          cmd: onboard.cmd,
          args: onboard.args,
          env: onboard.env,
        });
        if (onboardResult.exitCode !== 0) {
          const stderr = await onboardResult.stderr();
          return {
            success: false,
            message: "Failed to configure the agent.",
            error: `Onboard failed: ${stderr}`,
          };
        }
      }
    }

    // Write config files (if adapter provides static config instead of onboard)
    const configFiles = adapter.generateConfig(env, options?.history);
    if (configFiles.length > 0) {
      // Ensure parent directories exist
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
    const command = adapter.buildCommand(message, options?.history);
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
        env: command.env,
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

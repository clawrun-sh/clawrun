import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { humanId } from "human-id";
import { createAgent } from "@clawrun/agent";
import type { Agent } from "@clawrun/agent";
import { hasWakeHook } from "@clawrun/channel";
import type { ClawRunConfig } from "@clawrun/runtime";
import { getPlatformProvider } from "@clawrun/provider";
import type { ProgressCallback, ProgressEvent, PlatformStep } from "@clawrun/provider";
import {
  buildConfig,
  toEnvVars,
  generateSecret,
  createInstance,
  instanceDir,
  instanceAgentDir,
  instanceDeployDir,
  saveDeployedUrl,
  copyMirroredFiles,
} from "./instance/index.js";
import { getPreset, listPresets, getWorkspaceFiles } from "./presets/index.js";
import { ClawRunInstance } from "./instance.js";
import { DeployError } from "./errors.js";
import type { Tool } from "@clawrun/agent";
import type { DeployOptions, DeployResult, DeployStep } from "./types.js";
import type { InstanceStep } from "./instance/steps.js";

type NetworkPolicy = ClawRunConfig["sandbox"]["networkPolicy"];

/** Test whether `domain` matches a wildcard `pattern` (e.g. *.example.com). */
export function domainMatchesWildcard(domain: string, pattern: string): boolean {
  if (pattern === domain) return true;
  const re = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, "[^.]+") + "$");
  return re.test(domain);
}

export interface DerivedDomains {
  all: string[];
  groups: Array<{ reason: string; domains: string[] }>;
}

export function deriveAllowedDomains(
  agent: Agent,
  infraDomains: string[],
  provider?: string,
  channelNames?: string[],
): DerivedDomains {
  const groups: DerivedDomains["groups"] = [
    { reason: "Sandbox lifecycle (heartbeat, sidecar)", domains: [...infraDomains] },
  ];

  // Provider domain — derived from agent's model fetch endpoint
  if (provider) {
    const endpoint = agent.getModelsFetchEndpoint(provider);
    if (endpoint) {
      try {
        const hostname = new URL(endpoint.url).hostname;
        groups.push({ reason: `LLM provider (${provider})`, domains: [hostname] });
      } catch {
        /* malformed URL — skip */
      }
    }
  }

  // Channel domains — from ChannelInfo.apiDomains
  const supportedChannels = agent.getSupportedChannels();
  for (const ch of channelNames ?? []) {
    const info = supportedChannels.find((c) => c.id.toLowerCase() === ch.toLowerCase());
    if (info?.apiDomains?.length) {
      groups.push({ reason: `${info.name} channel`, domains: [...info.apiDomains] });
    }
  }

  const all = [...new Set(groups.flatMap((g) => g.domains))];
  return { all, groups };
}

function generateInstanceName(): string {
  return `clawrun-${humanId({ separator: "-", capitalize: false })}`;
}

/**
 * Seed workspace template .md files into the instance agent dir.
 */
function seedWorkspaceFiles(
  presetId: string,
  agentDir: string,
  agent: ReturnType<typeof createAgent>,
  customDir?: string,
  onProgress?: ProgressCallback<"seed-workspace">,
  selectedTools?: Tool[],
): void {
  const seedDir = agent.getSeedDirectory();
  if (seedDir === null) return;

  const targetDir = join(agentDir, seedDir);
  mkdirSync(targetDir, { recursive: true });

  const files = getWorkspaceFiles(presetId, customDir);
  let seeded = 0;
  for (const [filename, srcPath] of files) {
    const destPath = join(targetDir, filename);
    if (!existsSync(destPath)) {
      copyFileSync(srcPath, destPath);
      seeded++;
    }
  }

  // Seed skill files from selected tools
  if (selectedTools) {
    for (const tool of selectedTools) {
      if (!tool.skillContent) continue;
      const skillDir = join(targetDir, "skills", tool.id);
      const skillPath = join(skillDir, "SKILL.md");
      if (!existsSync(skillPath)) {
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(skillPath, tool.skillContent);
        seeded++;
      }
    }
  }

  // Seed custom dir skill subdirectories (recursive)
  if (customDir) {
    const customSkillsDir = join(customDir, "skills");
    if (existsSync(customSkillsDir)) {
      for (const entry of readdirSync(customSkillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const destDir = join(targetDir, "skills", entry.name);
        if (!existsSync(destDir)) {
          cpSync(join(customSkillsDir, entry.name), destDir, { recursive: true });
          seeded++;
        }
      }
    }
  }

  if (seeded > 0) {
    onProgress?.({
      step: "seed-workspace",
      message: `Seeded ${seeded} workspace template file${seeded > 1 ? "s" : ""}`,
    });
  }
}

/**
 * Non-interactive deploy orchestration.
 *
 * Takes all resolved inputs (no prompts) and executes the full deploy sequence:
 * resolve preset, check prerequisites, create project, provision state store,
 * build config, create instance, deploy, start sandbox.
 *
 * Emits typed {@link DeployProgressEvent} events via `onProgress`.
 */
export async function deploy(options: DeployOptions): Promise<DeployResult> {
  const { onProgress } = options;

  // Track the current high-level step so subsystem callbacks can be wrapped.
  let currentStep: DeployStep = "resolve-preset";

  /** Emit a typed deploy progress event. */
  const progress = (step: DeployStep, message: string, level?: ProgressEvent["level"]) => {
    currentStep = step;
    onProgress?.({ step, message, level });
  };

  /**
   * Wrap the deploy onProgress into a ProgressCallback for subsystems.
   * Subsystem events are forwarded with the current deploy step and their
   * own typed step as `detail`.
   *
   * The union type ensures this callback is assignable to both
   * `ProgressCallback<PlatformStep>` and `ProgressCallback<InstanceStep>`
   * via contravariance.
   */
  type SubStep = PlatformStep | InstanceStep | "seed-workspace";
  const subProgress: ProgressCallback<SubStep> | undefined = onProgress
    ? (event) =>
        onProgress({
          step: currentStep,
          message: event.message,
          level: event.level,
          detail: event.step,
        })
    : undefined;

  // 1. Resolve preset
  progress("resolve-preset", "Resolving preset...");
  const presetId = options.preset;
  const preset = getPreset(presetId);
  if (!preset) {
    const available = listPresets()
      .map((p) => p.id)
      .join(", ");
    throw new DeployError(
      "resolve-preset",
      `Unknown preset: "${presetId}". Available: ${available}`,
    );
  }

  // 2. Init platform
  progress("init-platform", "Initializing platform provider...");
  const platform = getPlatformProvider(preset.provider);

  // 3. Check prerequisites
  progress("check-prerequisites", "Checking prerequisites...");
  await platform.checkPrerequisites(subProgress);

  // 4. Detect tier
  progress("detect-tier", "Detecting platform tier...");
  const tier = await platform.detectTier();
  const limits = await platform.getLimits(tier);

  // 5. Create agent
  progress("create-agent", "Creating agent...");
  const agent = createAgent(preset.agent);

  // 6. Write agent config
  const name = options.name ?? generateInstanceName();

  // Track whether we've created local directories so we can clean up on failure
  let instanceCreated = false;

  try {
    const agentConfigDir = instanceAgentDir(name);
    mkdirSync(agentConfigDir, { recursive: true });
    instanceCreated = true;

    agent.writeSetupConfig(agentConfigDir, {
      provider: options.agent.provider,
      channels: options.agent.channels ?? {},
    });

    // 7. Seed workspace files
    progress("seed-workspace", "Seeding workspace files...");
    const toolIds = options.agent.tools ?? agent.getAvailableTools().map((t) => t.id);
    const selectedTools = agent.getAvailableTools().filter((t) => toolIds.includes(t.id));
    seedWorkspaceFiles(
      presetId,
      agentConfigDir,
      agent,
      options.customWorkspaceDir,
      subProgress,
      selectedTools,
    );

    // 8. Resolve network policy
    let networkPolicy: NetworkPolicy = options.networkPolicy ?? "allow-all";
    if (
      networkPolicy !== "allow-all" &&
      networkPolicy !== "deny-all" &&
      typeof networkPolicy === "object" &&
      "allow" in networkPolicy
    ) {
      // Merge in auto-derived domains
      const derived = deriveAllowedDomains(
        agent,
        platform.getInfraDomains(),
        options.agent.provider.provider,
        Object.keys(options.agent.channels ?? {}),
      );
      const currentAllow = networkPolicy.allow ?? [];
      const merged = [...new Set([...derived.all, ...currentAllow])];
      networkPolicy = { ...networkPolicy, allow: merged };
    }

    // 9. Generate secrets
    progress("generate-secrets", "Generating secrets...");
    const cronSecret = generateSecret();
    const jwtSecret = generateSecret();
    const webhookSecrets: Record<string, string> = {};
    const channelNames = Object.keys(options.agent.channels ?? {});
    for (const channelId of channelNames) {
      if (hasWakeHook(channelId)) {
        webhookSecrets[channelId] = generateSecret();
      }
    }
    const sandboxSecret = generateSecret();

    // 10. Create platform project
    progress("create-project", "Creating platform project...");
    let handle;
    try {
      handle = await platform.createProject(name, subProgress);
    } catch (err) {
      throw new DeployError("create-project", err instanceof Error ? err.message : String(err), {
        cause: err,
      });
    }

    // 11. Provision state store
    progress("provision-state", "Provisioning state store...");
    const tempDir = join(tmpdir(), `clawrun-setup-${name}-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    platform.writeProjectLink(tempDir, handle);

    let stateResult;
    if (options.stateStore?.id) {
      // Connect to existing store
      const stores = await platform.listStateStores();
      const store = stores.find((s) => s.id === options.stateStore!.id);
      if (!store) {
        rmSync(tempDir, { recursive: true, force: true });
        throw new DeployError(
          "provision-state",
          `State store "${options.stateStore.id}" not found.`,
        );
      }
      stateResult = await platform.connectStateStore(tempDir, store, handle.projectId, subProgress);
    } else {
      stateResult = await platform.provisionStateStore(tempDir, subProgress);
    }

    rmSync(tempDir, { recursive: true, force: true });

    if (!stateResult.success) {
      throw new DeployError("provision-state", "Failed to provision state store.");
    }

    // 12. Build config
    progress("build-config", "Building config...");
    const config = buildConfig(name, preset.id, preset.agent, {
      cronSecret,
      jwtSecret,
      webhookSecrets,
      sandboxSecret,
      provider: platform.id,
      bundlePaths: agent.getBinaryBundlePaths(),
      configPaths: agent.getBundleFiles(),
      tools: toolIds,
      networkPolicy,
      serverExternalPackages: platform.getServerExternalPackages(),
      deployedUrl: platform.getProjectUrl(name),
    });

    // 13. Create instance
    progress("create-instance", "Creating instance...");
    const clawrunEnv = toEnvVars(config);
    const allEnvVars: Record<string, string> = {
      ...clawrunEnv,
      ...stateResult.vars,
    };

    await createInstance(name, config, allEnvVars, platform, {
      presetDeps: agent.getInstallDependencies(),
      onProgress: subProgress,
    });

    const deployDir = instanceDeployDir(name);

    // 14. Platform setup
    progress("configure-platform", "Configuring platform...");
    platform.writeProjectLink(deployDir, handle);
    platform.patchPlatformConfig(deployDir, limits, subProgress);
    await platform.disableDeploymentProtection(deployDir, subProgress);

    // 15. Persist env vars
    progress("persist-env", "Persisting env vars...");
    await platform.persistEnvVars(deployDir, allEnvVars, subProgress);

    // 16. Deploy
    progress("deploy", "Deploying...");
    const url = await platform.deploy(deployDir, allEnvVars, subProgress);
    saveDeployedUrl(name, url);

    // 17. Start sandbox
    progress("start-sandbox", "Starting sandbox...");
    const instance = new ClawRunInstance({ api: { url, jwtSecret } });
    try {
      await instance.restart();
      progress("complete", "Deploy complete!");
    } catch {
      progress("complete", "Deploy complete — sandbox will start on first message.", "warning");
    }

    return { name, url, config, instance };
  } catch (err) {
    // Clean up local instance directory on failure
    if (instanceCreated) {
      const dir = instanceDir(name);
      if (existsSync(dir)) {
        progress("cleanup", "Cleaning up instance directory after failure...");
        rmSync(dir, { recursive: true, force: true });
      }
    }
    throw err;
  }
}

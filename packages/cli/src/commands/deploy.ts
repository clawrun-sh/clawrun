import { command, positional, option, optional, string } from "cmd-ts";
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import chalk from "chalk";
import { humanId } from "human-id";
import * as clack from "@clack/prompts";
import {
  getPreset,
  listPresets,
  getWorkspaceFiles,
  loadPresetFromDir,
  registerPreset,
} from "../presets/index.js";
import { getPlatformProvider } from "../platform/index.js";
import type {
  PlatformProvider,
  PlatformTier,
  PlatformLimits,
  ProjectHandle,
  StateStoreEntry,
} from "../platform/index.js";
import type { ClawRunConfig } from "@clawrun/runtime";
import { SANDBOX_DEFAULTS } from "@clawrun/runtime";
import {
  createInstance,
  instanceExists,
  getInstance,
  instanceAgentDir,
  instanceDeployDir,
  saveDeployedUrl,
  upgradeInstance,
  copyMirroredFiles,
  buildConfig,
  toEnvVars,
  readConfig,
  writeConfig,
  generateSecret,
} from "../instance/index.js";
import { hasWakeHook } from "@clawrun/channel";
import { createAgent } from "@clawrun/agent";
import type { Agent } from "@clawrun/agent";
import { yes } from "../args/yes.js";
import { startAgentChat } from "./agent.js";
import { printBanner } from "../banner.js";
import { createApiClient } from "../api.js";
import { promptProvider, promptChannels } from "../setup/index.js";
import type { ChannelSetupResult } from "../setup/index.js";

/** Test whether `domain` matches a wildcard `pattern` (e.g. *.example.com, cdn.*.net). */
export function domainMatchesWildcard(domain: string, pattern: string): boolean {
  if (pattern === domain) return true;
  // Convert wildcard pattern to regex: escape dots, replace * with [^.]+ (single label)
  const re = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, "[^.]+") + "$");
  return re.test(domain);
}

function generateInstanceName(): string {
  return `clawrun-${humanId({ separator: "-", capitalize: false })}`;
}

/** Map known provider/channel names to their API domains. */
export const PROVIDER_DOMAINS: Record<string, string[]> = {
  openai: ["api.openai.com"],
  openrouter: ["openrouter.ai"],
  anthropic: ["api.anthropic.com"],
  google: ["generativelanguage.googleapis.com"],
  groq: ["api.groq.com"],
  mistral: ["api.mistral.ai"],
  deepseek: ["api.deepseek.com"],
};

export const CHANNEL_DOMAINS: Record<string, string[]> = {
  telegram: ["api.telegram.org"],
  discord: ["discord.com", "gateway.discord.gg"],
  slack: ["slack.com"],
  matrix: ["matrix.org"],
  whatsapp: ["graph.facebook.com"],
  linq: ["api.linqapp.com"],
  nextcloud_talk: [],
  dingtalk: ["api.dingtalk.com"],
  qq: ["bots.qq.com"],
  lark: ["open.feishu.cn", "open.larksuite.com"],
  nostr: ["relay.damus.io", "nos.lol", "relay.primal.net", "relay.snort.social"],
};

interface DerivedDomains {
  /** All domains flat, for the allowlist. */
  all: string[];
  /** Labeled groups for display. */
  groups: Array<{ reason: string; domains: string[] }>;
}

export function deriveAllowedDomains(
  platform: PlatformProvider,
  provider?: string,
  channelNames?: string[],
): DerivedDomains {
  const groups: DerivedDomains["groups"] = [
    { reason: "Sandbox lifecycle (heartbeat, sidecar)", domains: [...platform.getInfraDomains()] },
  ];
  if (provider) {
    const domains = PROVIDER_DOMAINS[provider.toLowerCase()];
    if (domains) {
      groups.push({ reason: `LLM provider (${provider})`, domains: [...domains] });
    }
  }
  for (const ch of channelNames ?? []) {
    const domains = CHANNEL_DOMAINS[ch.toLowerCase()];
    if (domains) {
      groups.push({ reason: `${ch} channel`, domains: [...domains] });
    }
  }
  const all = [...new Set(groups.flatMap((g) => g.domains))];
  return { all, groups };
}

type NetworkPolicy = ClawRunConfig["sandbox"]["networkPolicy"];

async function promptNetworkPolicy(derived: DerivedDomains): Promise<NetworkPolicy> {
  const mode = await clack.select({
    message: "Sandbox network access",
    initialValue: "allow-all",
    options: [
      { value: "allow-all", label: "Allow all", hint: "unrestricted internet (default)" },
      { value: "restricted", label: "Restricted", hint: "specify allowed domains/CIDRs" },
    ],
  });

  if (clack.isCancel(mode)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }

  if (mode === "allow-all") return "allow-all";

  clack.log.info(
    `These domains are automatically allowed:\n` +
      derived.groups
        .map(
          (g) =>
            `  ${chalk.bold(g.reason)}\n` + g.domains.map((d) => chalk.dim(`    ${d}`)).join("\n"),
        )
        .join("\n"),
  );

  const domainsInput = await clack.text({
    message: "Additional allowed domains, e.g. myapi.example.com, *.cdn.net (comma-separated)",
  });

  if (clack.isCancel(domainsInput)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }

  const extra = domainsInput
    ? domainsInput
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean)
    : [];
  const domains = [...new Set([...derived.all, ...extra])];

  const cidrsInput = await clack.text({
    message: "Blocked CIDRs, e.g. 10.0.0.0/8 (comma-separated, optional)",
  });

  if (clack.isCancel(cidrsInput)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }

  const denyCidrs = cidrsInput
    ? cidrsInput
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
    : [];

  return denyCidrs.length > 0
    ? { allow: domains, subnets: { deny: denyCidrs } }
    : { allow: domains };
}

/**
 * Prompt for tool selection using clack multiselect checkboxes.
 * All tools checked by default.
 */
async function promptTools(
  agent: Agent,
  initialEnabled?: string[],
): Promise<import("@clawrun/agent").Tool[]> {
  const available = agent.getAvailableTools();
  if (available.length === 0) return [];

  const selected = await clack.multiselect({
    message: "Select tools to install in the sandbox",
    options: available.map((t) => ({
      value: t.id,
      label: t.name,
      hint: t.description,
    })),
    initialValues: initialEnabled ?? available.map((t) => t.id),
    required: false,
  });

  if (clack.isCancel(selected)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }

  const selectedIds = selected as string[];
  return available.filter((t) => selectedIds.includes(t.id));
}

/**
 * After a restricted policy is chosen, check if selected tools need domains
 * that aren't in the allow-list. Prompt the user to add them.
 */
async function promptToolDomains(
  tools: import("@clawrun/agent").Tool[],
  policy: NetworkPolicy,
): Promise<NetworkPolicy> {
  if (policy === "allow-all" || policy === "deny-all") return policy;
  if (!("allow" in policy)) return policy;

  if (tools.length === 0) return policy;

  const currentAllow = policy.allow ?? [];

  function isAllowed(domain: string): boolean {
    return currentAllow.some((pattern) => domainMatchesWildcard(domain, pattern));
  }

  for (const tool of tools) {
    const missing = tool.installDomains.filter((d) => !isAllowed(d));
    if (missing.length === 0) continue;

    clack.note(missing.map((d) => chalk.dim(d)).join("\n"), `${tool.name} Tool`);

    const addThem = await clack.confirm({
      message: `Allow ${tool.name} install domains?`,
      initialValue: true,
    });

    if (clack.isCancel(addThem)) {
      clack.cancel("Setup cancelled.");
      process.exit(0);
    }

    if (addThem) {
      currentAllow.push(...missing);
    } else {
      clack.log.warn(`${tool.name} will not work — requires: ${missing.join(", ")}`);
    }
  }

  return { ...policy, allow: [...new Set(currentAllow)] };
}

/**
 * Seed workspace template .md files into the instance agent dir.
 * Base templates are merged with preset-specific overrides.
 * Only copies files that don't already exist (preserves user customizations).
 */
function seedWorkspaceFiles(
  presetId: string,
  agentDir: string,
  agent: Agent,
  customDir?: string,
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
  if (seeded > 0) {
    clack.log.info(chalk.dim(`  Seeded ${seeded} workspace template file${seeded > 1 ? "s" : ""}`));
  }
}

async function detectTier(platform: PlatformProvider): Promise<{
  tier: PlatformTier;
  limits: PlatformLimits;
}> {
  const tier = await platform.detectTier();
  const limits = await platform.getLimits(tier);
  return { tier, limits };
}

async function handleNewInstance(
  instanceName: string | undefined,
  presetId: string | undefined,
  options: { yes?: boolean; customWorkspaceDir?: string },
): Promise<void> {
  // Resolve preset
  if (!presetId) {
    const presets = listPresets();
    if (presets.length === 1) {
      presetId = presets[0].id;
    } else {
      clack.log.error(
        `Please specify a preset: clawrun deploy <preset>\n  Available: ${presets.map((p) => p.id).join(", ")}`,
      );
      process.exit(1);
    }
  }

  const preset = getPreset(presetId);
  if (!preset) {
    const available = listPresets()
      .map((p) => p.id)
      .join(", ");
    clack.log.error(`Unknown preset: "${presetId}". Available: ${available}`);
    process.exit(1);
  }

  clack.intro(chalk.bold.cyan("ClawRun Setup"));

  const name = instanceName ?? generateInstanceName();
  const platform = getPlatformProvider(preset.provider);

  await platform.checkPrerequisites();

  const { tier, limits } = await detectTier(platform);
  const tierLabel = tier === "hobby" ? `${platform.name} free plan` : `${platform.name} paid plan`;
  const activeDurationMins = Math.round(SANDBOX_DEFAULTS.activeDuration / 60);

  let noteBody =
    `Instance:   ${chalk.bold(name)}\n` +
    `Preset:     ${preset.name}\n` +
    `Platform:   ${tierLabel}\n` +
    `Duration:   ${activeDurationMins} min per session`;

  if (options.customWorkspaceDir) {
    // Show only files from the custom dir that actually override base/preset defaults.
    // Check dirname() === customDir to avoid false positives when
    // the custom dir is an ancestor of the base or preset dirs.
    const resolved = getWorkspaceFiles(preset.id, options.customWorkspaceDir);
    const customFiles = [...resolved.entries()]
      .filter(([, srcPath]) => dirname(srcPath) === options.customWorkspaceDir)
      .map(([filename]) => filename);
    if (customFiles.length > 0) {
      noteBody += `\nWorkspace:  ${options.customWorkspaceDir}\n            ${customFiles.join(", ")}`;
    }
  }

  clack.note(noteBody, "New Instance");

  // ── Agent Configuration ──────────────────────────────────────
  clack.note("LLM provider, model, and messaging channels", "Agent Configuration");

  const agentConfigDir = instanceAgentDir(name);
  mkdirSync(agentConfigDir, { recursive: true });
  const agent = createAgent(preset.agent);

  // Provider setup
  const providerResult = await promptProvider(agent);
  clack.log.success(
    `Provider: ${chalk.green(providerResult.provider)} | Model: ${chalk.green(providerResult.model)}`,
  );

  // Channel setup
  let channelSetup: ChannelSetupResult = { channels: {}, channelNames: [] };
  if (!options.yes) {
    channelSetup = await promptChannels(agent, undefined, name);
  }

  // Tool selection
  let selectedTools: import("@clawrun/agent").Tool[] = [];
  if (!options.yes) {
    selectedTools = await promptTools(agent);
    if (selectedTools.length > 0) {
      clack.log.success(`Tools: ${selectedTools.map((t) => chalk.green(t.name)).join(", ")}`);
    }
  } else {
    selectedTools = agent.getAvailableTools();
  }

  // Write agent config (provider + channels)
  agent.writeSetupConfig(agentConfigDir, {
    provider: providerResult,
    channels: channelSetup.channels,
  });

  // Seed workspace template files into agent dir (only missing files)
  seedWorkspaceFiles(preset.id, agentConfigDir, agent, options.customWorkspaceDir);

  // ── Infrastructure ───────────────────────────────────────────
  clack.note("Network policy and state store", "Infrastructure");

  // Network policy prompt
  let networkPolicy: NetworkPolicy = "allow-all";
  if (!options.yes) {
    const derived = deriveAllowedDomains(
      platform,
      providerResult.provider,
      channelSetup.channelNames,
    );
    networkPolicy = await promptNetworkPolicy(derived);
    networkPolicy = await promptToolDomains(selectedTools, networkPolicy);
  }

  // ClawRun-specific settings
  const cronSecret = generateSecret();
  const jwtSecret = generateSecret();
  const webhookSecrets: Record<string, string> = {};
  for (const channelId of channelSetup.channelNames) {
    if (hasWakeHook(channelId)) {
      webhookSecrets[channelId] = generateSecret();
    }
  }
  const sandboxSecret = generateSecret();

  let handle: ProjectHandle;
  try {
    handle = await platform.createProject(name);
  } catch (err) {
    clack.log.error(
      `Failed to create project: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  // Temp dir for integration provisioning
  const tempDir = join(tmpdir(), `clawrun-setup-${name}-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  platform.writeProjectLink(tempDir, handle);

  // State store — offer to reuse an existing store
  let selectedStore: StateStoreEntry | undefined;

  if (!options.yes) {
    const stores = await platform.listStateStores();
    if (stores.length > 0) {
      clack.log.info(
        "Your agent needs a state store (Redis) to persist sandbox lifecycle state,\n" +
          "session data, and wake/sleep bookkeeping across restarts.\n" +
          chalk.dim("Instances can share a store or each have their own."),
      );
      const choice = await clack.select({
        message: "Select a state store",
        options: [
          ...stores.map((s) => ({
            value: s.id,
            label: s.name,
            hint: s.status,
          })),
          { value: "__new__", label: "\u2795 Create new store", hint: "provision a new store" },
        ],
      });

      if (clack.isCancel(choice)) {
        clack.cancel("Setup cancelled.");
        rmSync(tempDir, { recursive: true, force: true });
        process.exit(0);
      }

      if (choice !== "__new__") {
        selectedStore = stores.find((s) => s.id === choice);
      }
    }
  }

  const stateResult = selectedStore
    ? await platform.connectStateStore(tempDir, selectedStore, handle.projectId)
    : await platform.provisionStateStore(tempDir);

  if (!stateResult.success) {
    clack.log.error("Failed to provision state store.");
    rmSync(tempDir, { recursive: true, force: true });
    process.exit(1);
  }

  rmSync(tempDir, { recursive: true, force: true });

  // ── Deploy ───────────────────────────────────────────────────
  clack.note("Building and deploying to " + platform.name, "Deploy");

  const config = buildConfig(name, preset.id, preset.agent, {
    cronSecret,
    jwtSecret,
    webhookSecrets,
    sandboxSecret,
    provider: platform.id,
    bundlePaths: agent.getBinaryBundlePaths(),
    configPaths: agent.getBundleFiles(),
    tools: selectedTools.map((t) => t.id),
    networkPolicy,
    serverExternalPackages: platform.getServerExternalPackages(),
    platformUrlEnvVars: platform.getUrlEnvVars(),
  });

  // Derive env vars: ClawRun secrets (channel tokens live in bundled config.toml)
  const clawrunEnv = toEnvVars(config);
  const allEnvVars: Record<string, string> = {
    ...clawrunEnv,
    ...stateResult.vars,
  };

  await createInstance(name, config, allEnvVars, {
    presetDeps: agent.getInstallDependencies(),
  });
  const deployDir = instanceDeployDir(name);

  // Write the project link into .deploy/
  platform.writeProjectLink(deployDir, handle);

  // Patch platform config with plan-aware cron schedule
  platform.patchPlatformConfig(deployDir, limits);

  // Disable deployment protection
  await platform.disableDeploymentProtection(deployDir);

  // Persist all env vars to project
  await platform.persistEnvVars(deployDir, allEnvVars);

  // Deploy from .deploy/
  const url = await platform.deploy(deployDir, allEnvVars);
  saveDeployedUrl(name, url);
  await platform.persistEnvVars(deployDir, { CLAWRUN_BASE_URL: url });

  // Start sandbox
  if (jwtSecret) {
    const sandboxSpinner = clack.spinner();
    sandboxSpinner.start("Starting sandbox...");
    try {
      const api = createApiClient(url, jwtSecret);
      const res = await api.post("/api/v1/sandbox/restart");
      const result = (await res.json()) as Record<string, unknown>;
      sandboxSpinner.stop(chalk.green(`Sandbox: ${result.status ?? "ok"}`));
    } catch {
      sandboxSpinner.stop(
        chalk.yellow("Could not start sandbox — it will start on first message."),
      );
    }
  }

  // Success
  printSuccess(name, url, channelSetup.channelNames.length > 0);

  // Go straight into chat — the agent's BOOTSTRAP.md handles onboarding
  await startChat(name);
}

async function handleExistingInstance(name: string, options: { yes?: boolean }): Promise<void> {
  const meta = getInstance(name);
  if (!meta) {
    clack.log.error(`Instance "${name}" not found.`);
    process.exit(1);
  }

  const deployDir = instanceDeployDir(name);

  clack.intro(chalk.bold.cyan(`Redeploying: ${name}`));

  // Read config early to determine platform provider
  const existingConfig = readConfig(name);
  if (!existingConfig) {
    clack.log.error(`No clawrun.json found for instance "${name}".`);
    process.exit(1);
  }

  const platform = getPlatformProvider(existingConfig.instance.provider);

  await platform.checkPrerequisites();

  const { tier, limits } = await detectTier(platform);
  const tierLabel = tier === "hobby" ? `${platform.name} free plan` : `${platform.name} paid plan`;

  clack.note(
    `Instance:   ${chalk.bold(name)}\n` +
      `Preset:     ${meta.preset}\n` +
      `Platform:   ${tierLabel}\n` +
      `Version:    ${meta.appVersion}` +
      (meta.deployedUrl ? `\nURL:        ${meta.deployedUrl}` : ""),
    "Existing Instance",
  );

  // Offer reconfiguration
  if (!options.yes) {
    // ── Agent Configuration ──────────────────────────────────────
    clack.note("Reconfigure provider, model, or channels", "Agent Configuration");

    const agentConfigDir = instanceAgentDir(name);
    mkdirSync(agentConfigDir, { recursive: true });
    const agent = createAgent(existingConfig.agent.name);
    const existingSetup = agent.readSetup(agentConfigDir);

    const reconfigureProvider = await clack.confirm({
      message: "Reconfigure LLM provider & model?",
      initialValue: false,
    });

    if (!clack.isCancel(reconfigureProvider) && reconfigureProvider) {
      const result = await promptProvider(agent, existingSetup?.provider);
      clack.log.success(
        `Provider: ${chalk.green(result.provider)} | Model: ${chalk.green(result.model)}`,
      );
      // Write updated config
      agent.writeSetupConfig(agentConfigDir, {
        provider: result,
        channels: existingSetup?.channels ?? {},
      });
    }

    const channelResult = await promptChannels(agent, existingSetup?.channels, name);
    if (Object.keys(channelResult.channels).length > 0) {
      const currentSetup = agent.readSetup(agentConfigDir);
      agent.writeSetupConfig(agentConfigDir, {
        provider: (currentSetup?.provider as {
          provider: string;
          apiKey: string;
          model: string;
        }) ?? {
          provider: "openrouter",
          apiKey: "",
          model: "anthropic/claude-sonnet-4-6",
        },
        channels: channelResult.channels,
      });

      // Generate webhook secrets for newly added channels that don't have one yet
      const currentSecrets = existingConfig.secrets?.webhookSecrets ?? {};
      for (const channelId of Object.keys(channelResult.channels)) {
        if (hasWakeHook(channelId) && !currentSecrets[channelId]) {
          currentSecrets[channelId] = generateSecret();
        }
      }
      existingConfig.secrets = { ...existingConfig.secrets, webhookSecrets: currentSecrets };
    }

    // Tool reconfiguration
    const currentToolIds = existingConfig.agent.tools ?? [];
    const reconfigureTools = await clack.confirm({
      message: `Reconfigure tools?`,
      initialValue: false,
    });

    let redeployTools: import("@clawrun/agent").Tool[] = [];
    if (!clack.isCancel(reconfigureTools) && reconfigureTools) {
      redeployTools = await promptTools(agent, currentToolIds);
      existingConfig.agent.tools = redeployTools.map((t) => t.id);
      if (redeployTools.length > 0) {
        clack.log.success(`Tools: ${redeployTools.map((t) => chalk.green(t.name)).join(", ")}`);
      }
    } else {
      const allTools = agent.getAvailableTools();
      redeployTools = allTools.filter((t) => currentToolIds.includes(t.id));
    }

    // ── Infrastructure ───────────────────────────────────────────
    clack.note("Network policy", "Infrastructure");

    const currentPolicy = existingConfig.sandbox.networkPolicy;
    const currentLabel = typeof currentPolicy === "string" ? currentPolicy : "restricted";

    const policyAction = await clack.select({
      message: "Reconfigure network policy?",
      initialValue: "keep",
      options: [
        { value: "keep", label: "Keep current", hint: currentLabel },
        { value: "restricted", label: "Change to restricted" },
        { value: "allow-all", label: "Change to allow-all" },
      ],
    });

    if (!clack.isCancel(policyAction)) {
      if (policyAction === "restricted") {
        const currentChannels = agent.readSetup(agentConfigDir)?.channels;
        const channelNames = currentChannels ? Object.keys(currentChannels) : [];
        const derived = deriveAllowedDomains(platform, undefined, channelNames);
        existingConfig.sandbox.networkPolicy = await promptNetworkPolicy(derived);
        existingConfig.sandbox.networkPolicy = await promptToolDomains(
          redeployTools,
          existingConfig.sandbox.networkPolicy,
        );
      } else if (policyAction === "allow-all") {
        existingConfig.sandbox.networkPolicy = "allow-all";
      } else if (
        policyAction === "keep" &&
        typeof currentPolicy === "object" &&
        "allow" in currentPolicy
      ) {
        // "Keep current" with a restricted policy — ensure newly added
        // channels and tools have their domains in the allow-list.
        const currentChannels = agent.readSetup(agentConfigDir)?.channels;
        const channelNames = currentChannels ? Object.keys(currentChannels) : [];
        const derived = deriveAllowedDomains(platform, undefined, channelNames);
        const currentAllow = currentPolicy.allow ?? [];
        const missing = derived.all.filter(
          (d) => !currentAllow.some((p) => domainMatchesWildcard(d, p)),
        );
        if (missing.length > 0) {
          clack.note(missing.join("\n"), "Missing domains for configured channels");
          const addThem = await clack.confirm({
            message: "Add these to your allow-list?",
            initialValue: true,
          });
          if (!clack.isCancel(addThem) && addThem) {
            existingConfig.sandbox.networkPolicy = {
              ...currentPolicy,
              allow: [...new Set([...currentAllow, ...missing])],
            };
          }
        }
        // Also check tool domains
        existingConfig.sandbox.networkPolicy = await promptToolDomains(
          redeployTools,
          existingConfig.sandbox.networkPolicy,
        );
      }
    }
  }

  // Persist any config changes (e.g. network policy) before upgrade copies files
  writeConfig(name, existingConfig);

  // Seed any missing workspace template files (upgrade path)
  if (existingConfig.instance.preset) {
    const agentForSeed = createAgent(existingConfig.agent.name);
    seedWorkspaceFiles(existingConfig.instance.preset, instanceAgentDir(name), agentForSeed);
  }

  // ── Deploy ───────────────────────────────────────────────────
  clack.note("Upgrading and deploying to " + platform.name, "Deploy");

  // Upgrade instance
  await upgradeInstance(name);

  // Patch platform config in .deploy/
  platform.patchPlatformConfig(deployDir, limits);

  // Re-read config after upgrade (upgradeInstance may modify it on disk)
  const config = readConfig(name);
  if (!config) {
    clack.log.error(`No clawrun.json found for instance "${name}".`);
    process.exit(1);
  }

  // Ensure browser is enabled with agent-browser backend (backfill for older instances).
  // If reconfiguration happened above, writeSetupConfig already handled this.
  // For --yes mode or when user skips reconfiguration, do it here.
  {
    const agentObj = createAgent(config.agent.name);
    const agentCfgDir = instanceAgentDir(name);
    const currentSetup = agentObj.readSetup(agentCfgDir);
    if (currentSetup?.provider?.provider) {
      agentObj.writeSetupConfig(agentCfgDir, {
        provider: currentSetup.provider as { provider: string; apiKey: string; model: string },
        channels: currentSetup.channels ?? {},
      });
    }
  }

  // Copy mirrored files into .deploy/ (picks up updated config.toml)
  copyMirroredFiles(name);

  // Derive env vars: ClawRun secrets (channel tokens live in bundled config.toml)
  const clawrunEnv = toEnvVars(config);

  // Persist env vars to .deploy/
  await platform.persistEnvVars(deployDir, clawrunEnv);

  // Deploy from .deploy/
  const url = await platform.deploy(deployDir, clawrunEnv);
  saveDeployedUrl(name, url);
  await platform.persistEnvVars(deployDir, { CLAWRUN_BASE_URL: url });

  // Restart sandbox
  const upgradeJwtSecret = clawrunEnv["CLAWRUN_JWT_SECRET"];
  if (upgradeJwtSecret) {
    const sandboxSpinner = clack.spinner();
    sandboxSpinner.start("Restarting sandbox...");
    try {
      const api = createApiClient(url, upgradeJwtSecret);
      const res = await api.post("/api/v1/sandbox/restart");
      const result = (await res.json()) as Record<string, unknown>;
      sandboxSpinner.stop(chalk.green(`Sandbox: ${result.status ?? "ok"}`));
    } catch (err) {
      sandboxSpinner.stop(
        chalk.yellow("Could not restart sandbox — it will start on first message."),
      );
      clack.log.info(chalk.dim(`${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // Success
  const agentForChannels = createAgent(config.agent.name);
  const channelSetupForSuccess = agentForChannels.readSetup(instanceAgentDir(name));
  const hasChannels = Object.keys(channelSetupForSuccess?.channels ?? {}).length > 0;
  printSuccess(name, url, hasChannels);

  // Go straight into chat
  await startChat(name);
}

function printSuccess(name: string, url: string, hasChannels: boolean): void {
  clack.log.success(chalk.bold.green("Deployment successful!"));
  clack.log.info(
    `${chalk.bold("Instance:")} ${chalk.cyan(name)}\n` +
      `${chalk.bold("URL:")} ${chalk.cyan(url)}\n` +
      `${chalk.bold("Health:")} ${chalk.cyan(`${url}/api/v1/health`)}` +
      (hasChannels ? chalk.dim("\n\nYour agent is live!") : ""),
  );

  clack.outro("Done!");
}

async function startChat(name: string): Promise<void> {
  const freshConfig = readConfig(name);
  if (!freshConfig) {
    clack.log.error(`Could not read config for "${name}".`);
    return;
  }

  await startAgentChat(name, freshConfig, {
    initialMessage: "Hey! I just set you up. Introduce yourself and let's get started.",
  });
}

export const deploy = command({
  name: "deploy",
  description: "Create or upgrade and deploy an instance",
  args: {
    preset: positional({
      type: optional(string),
      displayName: "preset",
      description: "Preset name or folder path with workspace .md files",
    }),
    name: option({
      long: "name",
      short: "n",
      type: optional(string),
      description: "Instance name",
    }),
    yes,
  },
  async handler({ preset: presetArg, name, yes }) {
    printBanner();

    // Redeploy existing instance
    if (name && instanceExists(name)) {
      return handleExistingInstance(name, { yes });
    }

    // Resolve preset arg — folder path or built-in name
    let presetId: string | undefined;
    let customWorkspaceDir: string | undefined;

    if (presetArg) {
      const resolved = resolve(presetArg);
      if (existsSync(resolved) && statSync(resolved).isDirectory()) {
        // Folder path — check for preset.json inside
        const folderPreset = loadPresetFromDir(resolved);
        if (folderPreset) {
          presetId = folderPreset.id;
          // Register it so getPreset() works downstream
          registerPreset(folderPreset);
        }
        customWorkspaceDir = resolved;
      } else {
        presetId = presetArg;
      }
    }

    return handleNewInstance(name, presetId, { yes, customWorkspaceDir });
  },
});

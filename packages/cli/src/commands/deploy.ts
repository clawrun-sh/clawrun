import { command, positional, option, optional, string } from "cmd-ts";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import chalk from "chalk";
import { humanId } from "human-id";
import * as clack from "@clack/prompts";
import { getPreset, listPresets, getWorkspaceFiles } from "../presets/index.js";
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
import { configDefaults } from "zeroclaw";
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
function domainMatchesWildcard(domain: string, pattern: string): boolean {
  if (pattern === domain) return true;
  // Convert wildcard pattern to regex: escape dots, replace * with [^.]+ (single label)
  const re = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, "[^.]+") + "$");
  return re.test(domain);
}

function generateInstanceName(): string {
  return `clawrun-${humanId({ separator: "-", capitalize: false })}`;
}

/** Map known provider/channel names to their API domains. */
const PROVIDER_DOMAINS: Record<string, string[]> = {
  openai: ["api.openai.com"],
  openrouter: ["openrouter.ai"],
  anthropic: ["api.anthropic.com"],
  google: ["generativelanguage.googleapis.com"],
  groq: ["api.groq.com"],
  mistral: ["api.mistral.ai"],
  deepseek: ["api.deepseek.com"],
};

const CHANNEL_DOMAINS: Record<string, string[]> = {
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

const INFRA_DOMAINS = ["*.vercel.app", "*.vercel.sh"];

/**
 * Deploy-time defaults for agent setup.
 * Backends derived from ZeroClaw schema defaults.
 * Explicit overrides: browser enabled + wildcard domains (schema defaults to disabled + empty).
 */
const DEPLOY_AGENT_DEFAULTS = {
  memory: { backend: configDefaults.memory?.backend ?? "sqlite" },
  browser: {
    enabled: true, // override: schema defaults to false
    backend: configDefaults.browser?.backend ?? "agent_browser",
    allowedDomains: ["*"] as string[], // override: schema defaults to []
  },
};

interface DerivedDomains {
  /** All domains flat, for the allowlist. */
  all: string[];
  /** Labeled groups for display. */
  groups: Array<{ reason: string; domains: string[] }>;
}

function deriveAllowedDomains(provider?: string, channelNames?: string[]): DerivedDomains {
  const groups: DerivedDomains["groups"] = [
    { reason: "Sandbox lifecycle (heartbeat, sidecar)", domains: [...INFRA_DOMAINS] },
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
 * After a restricted policy is chosen, check if enabled tools need domains
 * that aren't in the allow-list. Prompt the user to add them.
 */
async function promptToolDomains(
  agent: Agent,
  agentDir: string,
  policy: NetworkPolicy,
): Promise<NetworkPolicy> {
  if (policy === "allow-all" || policy === "deny-all") return policy;
  if (!("allow" in policy)) return policy;

  const tools = agent.getToolDomains(agentDir);
  if (tools.length === 0) return policy;

  const currentAllow = policy.allow ?? [];

  function isAllowed(domain: string): boolean {
    return currentAllow.some((pattern) => domainMatchesWildcard(domain, pattern));
  }

  for (const tool of tools) {
    const missing = tool.installDomains.filter((d) => !isAllowed(d));
    if (missing.length === 0) continue;

    const addThem = await clack.confirm({
      message:
        `The ${tool.name} tool needs these domains for installation:\n` +
        missing.map((d) => chalk.dim(`  ${d}`)).join("\n") +
        `\nAdd them to your allow-list?`,
      initialValue: true,
    });

    if (clack.isCancel(addThem)) {
      clack.cancel("Setup cancelled.");
      process.exit(0);
    }

    if (addThem) {
      currentAllow.push(...missing);
    } else {
      clack.log.warn(
        `${tool.name} will not be available — it cannot be installed without network access to: ${missing.join(", ")}`,
      );
    }
  }

  return { ...policy, allow: [...new Set(currentAllow)] };
}

/**
 * Seed workspace template .md files into the instance agent dir.
 * Base templates are merged with preset-specific overrides.
 * Only copies files that don't already exist (preserves user customizations).
 */
function seedWorkspaceFiles(presetId: string, agentDir: string): void {
  // ZeroClaw reads workspace files from {configDir}/workspace/, not configDir itself
  const workspaceDir = join(agentDir, "workspace");
  mkdirSync(workspaceDir, { recursive: true });

  const files = getWorkspaceFiles(presetId);
  let seeded = 0;
  for (const [filename, srcPath] of files) {
    const destPath = join(workspaceDir, filename);
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
  options: { yes?: boolean },
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

  clack.note(
    `Instance:   ${chalk.bold(name)}\n` +
      `Preset:     ${preset.name}\n` +
      `Platform:   ${tierLabel}\n` +
      `Duration:   ${activeDurationMins} min per session`,
    "New Instance",
  );

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
    channelSetup = await promptChannels(agent);
  }

  // Write agent config (provider + channels + memory + browser)
  agent.writeSetupConfig(agentConfigDir, {
    provider: providerResult,
    channels: channelSetup.channels,
    ...DEPLOY_AGENT_DEFAULTS,
  });

  // Seed workspace template files into agent dir (only missing files)
  seedWorkspaceFiles(preset.id, agentConfigDir);

  // ── Infrastructure ───────────────────────────────────────────
  clack.note("Network policy and state store", "Infrastructure");

  // Network policy prompt
  let networkPolicy: NetworkPolicy = "allow-all";
  if (!options.yes) {
    const derived = deriveAllowedDomains(providerResult.provider, channelSetup.channelNames);
    networkPolicy = await promptNetworkPolicy(derived);
    networkPolicy = await promptToolDomains(agent, agentConfigDir, networkPolicy);
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
    bundlePaths: preset.bundlePaths,
    networkPolicy,
  });

  // Derive env vars: ClawRun secrets (channel tokens live in bundled config.toml)
  const clawrunEnv = toEnvVars(config);
  const allEnvVars: Record<string, string> = {
    ...clawrunEnv,
    ...stateResult.vars,
  };

  await createInstance(name, config, allEnvVars);
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
        ...DEPLOY_AGENT_DEFAULTS,
      });
    }

    const channelResult = await promptChannels(agent, existingSetup?.channels);
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
        ...DEPLOY_AGENT_DEFAULTS,
      });
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

    if (!clack.isCancel(policyAction) && policyAction !== "keep") {
      if (policyAction === "restricted") {
        const currentChannels = agent.readSetup(agentConfigDir)?.channels;
        const channelNames = currentChannels ? Object.keys(currentChannels) : [];
        const derived = deriveAllowedDomains(undefined, channelNames);
        existingConfig.sandbox.networkPolicy = await promptNetworkPolicy(derived);
        existingConfig.sandbox.networkPolicy = await promptToolDomains(
          agent,
          agentConfigDir,
          existingConfig.sandbox.networkPolicy,
        );
      } else {
        // Explicit allow-all to clear any previous restricted policy
        existingConfig.sandbox.networkPolicy = "allow-all";
      }
    }
  }

  // Persist any config changes (e.g. network policy) before upgrade copies files
  writeConfig(name, existingConfig);

  // Seed any missing workspace template files (upgrade path)
  if (existingConfig.instance.preset) {
    seedWorkspaceFiles(existingConfig.instance.preset, instanceAgentDir(name));
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
        ...DEPLOY_AGENT_DEFAULTS,
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
    nameOrPreset: positional({
      type: optional(string),
      displayName: "name",
      description: "Instance name or preset",
    }),
    yes,
    preset: option({
      long: "preset",
      short: "p",
      type: optional(string),
      description: "Preset to use",
    }),
  },
  async handler({ nameOrPreset, yes, preset }) {
    printBanner();

    // Determine if the argument is a preset name or an instance name.
    const presetNames = listPresets().map((p) => p.id);
    let instanceName: string | undefined;
    let presetId: string | undefined = preset;

    if (nameOrPreset) {
      if (instanceExists(nameOrPreset)) {
        instanceName = nameOrPreset;
      } else if (presetNames.includes(nameOrPreset)) {
        presetId = nameOrPreset;
      } else {
        instanceName = nameOrPreset;
      }
    }

    // PATH B: Existing instance — upgrade + redeploy
    if (instanceName && instanceExists(instanceName)) {
      return handleExistingInstance(instanceName, { yes });
    }

    // PATH A: New instance
    return handleNewInstance(instanceName, presetId, { yes });
  },
});

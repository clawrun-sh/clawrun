import { command, positional, option, optional, string } from "cmd-ts";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as TOML from "@iarna/toml";
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
import {
  createInstance,
  instanceExists,
  getInstance,
  instanceDir,
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
import { extractChannelEnvVars, getChannelSecretDefinitions } from "@clawrun/channel";
import { createAgent } from "@clawrun/agent";
import { readParsedConfig } from "zeroclaw";
import { yes } from "../args/yes.js";
import { startAgentChat } from "./agent.js";
import { printBanner } from "../banner.js";
import { createApiClient } from "../api.js";

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
};

const INFRA_DOMAINS = ["*.vercel.app", "*.vercel.sh"];

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

// Default active duration from the Zod schema (600s = 10 min)
const DEFAULT_ACTIVE_DURATION_S = 600;

async function detectAndPrintTier(platform: PlatformProvider): Promise<{
  tier: PlatformTier;
  limits: PlatformLimits;
}> {
  const tier = await platform.detectTier();
  const limits = await platform.getLimits(tier);
  const activeDurationMins = Math.round(DEFAULT_ACTIVE_DURATION_S / 60);

  const tierLabel = tier === "hobby" ? `${platform.name} free plan` : `${platform.name} paid plan`;
  const lifecycleMode = tier === "hobby" ? "webhook-driven" : "heartbeat-driven";

  clack.log.info(
    `${chalk.bold(`${tierLabel} detected`)}\n` +
      chalk.dim(`  Heartbeat cron:    ${limits.heartbeatCron}\n`) +
      chalk.dim(`  Active duration:   ${activeDurationMins} minutes per session\n`) +
      chalk.dim(`  Lifecycle mode:    ${lifecycleMode}`),
  );

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
      console.error(chalk.red("Please specify a preset: clawrun deploy <preset>"));
      console.error(chalk.dim(`  Available: ${presets.map((p) => p.id).join(", ")}`));
      process.exit(1);
    }
  }

  const preset = getPreset(presetId);
  if (!preset) {
    const available = listPresets()
      .map((p) => p.id)
      .join(", ");
    console.error(chalk.red(`Unknown preset: "${presetId}". Available: ${available}`));
    process.exit(1);
  }

  clack.intro(chalk.bold.cyan("ClawRun Setup"));

  // Instance name
  const name = instanceName ?? generateInstanceName();
  clack.log.step(`Instance: ${chalk.bold(name)}`);
  clack.log.info(`Preset: ${preset.name} — ${preset.description}`);

  const platform = getPlatformProvider(preset.provider);

  // Check prerequisites
  await platform.checkPrerequisites();

  // Detect tier
  const { limits } = await detectAndPrintTier(platform);
  const defaultActiveDuration = DEFAULT_ACTIVE_DURATION_S;

  // ============================================================
  // Agent config via napi-rs (required — no fallback)
  // ============================================================

  let napi: typeof import("zeroclaw-napi");
  try {
    napi = await import("zeroclaw-napi");
  } catch (err) {
    clack.log.error(
      `ZeroClaw native bridge is required but could not be loaded.\n` +
        chalk.dim(`  ${err instanceof Error ? err.message : String(err)}\n`) +
        chalk.dim("  Run: cd packages/zeroclaw-napi && bash build-docker.sh"),
    );
    process.exit(1);
  }

  // Redirect ZeroClaw config to instance's agent/ directory (never touch ~/.zeroclaw/)
  const agentConfigDir = instanceAgentDir(name);
  mkdirSync(agentConfigDir, { recursive: true });
  const prevConfigDir = process.env.ZEROCLAW_CONFIG_DIR;
  process.env.ZEROCLAW_CONFIG_DIR = agentConfigDir;

  // Memory backend — always sqlite (fast, hybrid search, snapshot-safe)
  const memoryBackend = "sqlite";

  // Provider setup via ZeroClaw's interactive wizard
  clack.log.step("Configuring LLM provider...");
  clack.log.info(chalk.dim("ZeroClaw's provider wizard will guide you through setup.\n"));

  const providerResult = await napi.runProviderWizard();
  clack.log.success(
    `Provider: ${chalk.green(providerResult.provider)} | Model: ${chalk.green(providerResult.model)}`,
  );

  // Channel setup via ZeroClaw's interactive wizard
  if (!options.yes) {
    const configureChannels = await clack.confirm({
      message: "Configure messaging channels? (Telegram, Discord, Slack, etc.)",
      initialValue: true,
    });

    if (clack.isCancel(configureChannels)) {
      clack.cancel("Setup cancelled.");
      process.exit(0);
    }

    if (configureChannels) {
      clack.log.step("Configuring channels...");
      clack.log.info(chalk.dim("ZeroClaw's channel wizard will guide you through setup.\n"));
      await napi.runChannelWizard();
      clack.log.success("Channel configuration saved.");
    }
  }

  // Write memory + browser config into zeroclaw config.toml
  const configTomlPath = join(agentConfigDir, "config.toml");
  const tomlContent = readFileSync(configTomlPath, "utf-8");
  const parsed = TOML.parse(tomlContent);
  parsed.memory = { ...((parsed.memory as Record<string, unknown>) ?? {}), backend: memoryBackend };
  // Enable browser with agent-browser (Chromium) backend.
  // Domains are unrestricted at the agent level — the sandbox firewall is the real boundary.
  parsed.browser = {
    ...((parsed.browser as Record<string, unknown>) ?? {}),
    enabled: true,
    backend: "agent_browser",
    allowed_domains: ["*"],
  };
  writeFileSync(configTomlPath, TOML.stringify(parsed as TOML.JsonMap));

  // Restore ZEROCLAW_CONFIG_DIR
  if (prevConfigDir !== undefined) process.env.ZEROCLAW_CONFIG_DIR = prevConfigDir;
  else delete process.env.ZEROCLAW_CONFIG_DIR;

  // Seed workspace template files into agent dir (only missing files)
  seedWorkspaceFiles(preset.id, agentConfigDir);

  // Network policy prompt
  let networkPolicy: NetworkPolicy = "allow-all";
  if (!options.yes) {
    const configToml = TOML.parse(readFileSync(configTomlPath, "utf-8"));
    const cc = configToml.channels_config as Record<string, unknown> | undefined;
    const channelNames = cc
      ? Object.entries(cc)
          .filter(([k, v]) => v != null && typeof v === "object" && k !== "cli")
          .map(([k]) => k)
      : [];
    const derived = deriveAllowedDomains(providerResult.provider, channelNames);
    networkPolicy = await promptNetworkPolicy(derived);
  }

  // ClawRun-specific settings
  const activeDuration = defaultActiveDuration;
  const cronSecret = generateSecret();
  const jwtSecret = generateSecret();
  const webhookSecrets: Record<string, string> = {};
  for (const def of getChannelSecretDefinitions()) {
    webhookSecrets[def.channelId] = generateSecret();
  }
  const sandboxSecret = generateSecret();

  // ============================================================
  // Phase 1: Create project + provision state store
  // ============================================================

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

  // ============================================================
  // Phase 2: Build instance + deploy
  // ============================================================

  const config = buildConfig(name, preset.id, preset.agent, {
    activeDuration,
    cronSecret,
    jwtSecret,
    webhookSecrets,
    sandboxSecret,
    provider: platform.id,
    bundlePaths: preset.bundlePaths,
    networkPolicy,
  });

  // Derive env vars: ClawRun secrets + agent channel tokens
  const agentConfig = readParsedConfig(agentConfigDir);
  const agentAdapter = createAgent(preset.agent);
  const agentEnv = extractChannelEnvVars(
    agentConfig as Record<string, unknown>,
    agentAdapter.channelsConfigKey,
  );
  const clawrunEnv = toEnvVars(config);
  const allEnvVars: Record<string, string> = {
    ...clawrunEnv,
    ...agentEnv,
    ...stateResult.vars,
  };

  const dir = await createInstance(name, config, allEnvVars);
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
  clack.log.step("Starting sandbox...");
  if (jwtSecret) {
    try {
      const api = createApiClient(url, jwtSecret);
      const res = await api.post("/api/v1/sandbox/restart");
      const result = (await res.json()) as Record<string, unknown>;
      clack.log.success(`Sandbox: ${result.status ?? "ok"}`);
    } catch {
      clack.log.warn("Could not start sandbox — it will start on first message.");
    }
  }

  // Success
  const botToken = allEnvVars["CLAWRUN_TELEGRAM_BOT_TOKEN"];
  printSuccess(name, url, botToken);

  // Go straight into chat — the agent's BOOTSTRAP.md handles onboarding
  await startChat(name);
}

async function handleExistingInstance(name: string, options: { yes?: boolean }): Promise<void> {
  const meta = getInstance(name);
  if (!meta) {
    console.error(chalk.red(`Instance "${name}" not found.`));
    process.exit(1);
  }

  const dir = instanceDir(name);
  const deployDir = instanceDeployDir(name);

  clack.intro(chalk.bold.cyan(`Redeploying: ${name}`));
  clack.log.info(`Preset: ${meta.preset} | App: ${meta.appVersion}`);
  if (meta.deployedUrl) {
    clack.log.info(`Last deployed to: ${meta.deployedUrl}`);
  }

  // Read config early to determine platform provider
  const existingConfig = readConfig(name);
  if (!existingConfig) {
    clack.log.error(`No clawrun.json found for instance "${name}".`);
    process.exit(1);
  }

  const platform = getPlatformProvider(existingConfig.instance.provider);

  // Check prerequisites
  await platform.checkPrerequisites();

  // Detect tier
  const { limits } = await detectAndPrintTier(platform);

  // Offer reconfiguration — two separate yes/no prompts
  // (napi may or may not be loaded depending on user choices)
  if (!options.yes) {
    const agentConfigDir = instanceAgentDir(name);
    mkdirSync(agentConfigDir, { recursive: true });

    let napiLoaded = false;
    let napi: typeof import("zeroclaw-napi");

    const loadNapi = async () => {
      if (napiLoaded) return;
      try {
        napi = await import("zeroclaw-napi");
        napiLoaded = true;
      } catch (err) {
        clack.log.error(
          `ZeroClaw native bridge is required but could not be loaded.\n` +
            chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`),
        );
        process.exit(1);
      }
    };

    const reconfigureProvider = await clack.confirm({
      message: "Reconfigure LLM provider & model?",
      initialValue: false,
    });

    if (!clack.isCancel(reconfigureProvider) && reconfigureProvider) {
      await loadNapi();
      const prev = process.env.ZEROCLAW_CONFIG_DIR;
      process.env.ZEROCLAW_CONFIG_DIR = agentConfigDir;
      const result = await napi!.runProviderWizard();
      clack.log.success(
        `Provider: ${chalk.green(result.provider)} | Model: ${chalk.green(result.model)}`,
      );
      if (prev !== undefined) process.env.ZEROCLAW_CONFIG_DIR = prev;
      else delete process.env.ZEROCLAW_CONFIG_DIR;
    }

    const reconfigureChannels = await clack.confirm({
      message: "Reconfigure messaging channels?",
      initialValue: false,
    });

    if (!clack.isCancel(reconfigureChannels) && reconfigureChannels) {
      await loadNapi();
      const prev = process.env.ZEROCLAW_CONFIG_DIR;
      process.env.ZEROCLAW_CONFIG_DIR = agentConfigDir;

      // Show currently configured channels before the wizard
      try {
        const current = readParsedConfig(agentConfigDir);
        const cc = current.channels_config as Record<string, unknown> | undefined;
        if (cc) {
          const active = Object.entries(cc)
            .filter(([k, v]) => v != null && typeof v === "object" && k !== "cli")
            .map(([k]) => k);
          if (active.length > 0) {
            clack.log.info(
              `Currently configured: ${active.map((c) => chalk.green(c)).join(", ")}\n` +
                chalk.dim("  These will be preserved unless you reconfigure them."),
            );
          }
        }
      } catch {
        // non-fatal — proceed with wizard
      }

      await napi!.runChannelWizard();
      clack.log.success("Channel configuration saved.");
      if (prev !== undefined) process.env.ZEROCLAW_CONFIG_DIR = prev;
      else delete process.env.ZEROCLAW_CONFIG_DIR;
    }

    // Network policy reconfig
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
        const agentCfg = readParsedConfig(agentConfigDir);
        const cc = agentCfg.channels_config as Record<string, unknown> | undefined;
        const channelNames = cc
          ? Object.entries(cc)
              .filter(([k, v]) => v != null && typeof v === "object" && k !== "cli")
              .map(([k]) => k)
          : [];
        const derived = deriveAllowedDomains(undefined, channelNames);
        existingConfig.sandbox.networkPolicy = await promptNetworkPolicy(derived);
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
  // Domains are unrestricted at the agent level — the sandbox firewall is the real boundary.
  const agentTomlPath = join(instanceAgentDir(name), "config.toml");
  if (existsSync(agentTomlPath)) {
    const agentToml = TOML.parse(readFileSync(agentTomlPath, "utf-8"));
    agentToml.browser = {
      ...((agentToml.browser as Record<string, unknown>) ?? {}),
      enabled: true,
      backend: "agent_browser",
      allowed_domains: ["*"],
    };
    writeFileSync(agentTomlPath, TOML.stringify(agentToml as TOML.JsonMap));
  }

  // Copy mirrored files into .deploy/ (picks up updated config.toml)
  copyMirroredFiles(name);

  // Derive env vars: ClawRun secrets + agent channel tokens
  const agentDir = instanceAgentDir(name);
  const agentConfig = readParsedConfig(agentDir);
  const agentAdapter = createAgent(config.agent.name);
  const agentEnv = extractChannelEnvVars(
    agentConfig as Record<string, unknown>,
    agentAdapter.channelsConfigKey,
  );
  const clawrunEnv = { ...toEnvVars(config), ...agentEnv };

  // Persist env vars to .deploy/
  await platform.persistEnvVars(deployDir, clawrunEnv);

  // Deploy from .deploy/
  const url = await platform.deploy(deployDir, clawrunEnv);
  saveDeployedUrl(name, url);
  await platform.persistEnvVars(deployDir, { CLAWRUN_BASE_URL: url });

  // Restart sandbox
  clack.log.step("Restarting sandbox...");
  const upgradeJwtSecret = clawrunEnv["CLAWRUN_JWT_SECRET"];
  if (upgradeJwtSecret) {
    try {
      const api = createApiClient(url, upgradeJwtSecret);
      const res = await api.post("/api/v1/sandbox/restart");
      const result = (await res.json()) as Record<string, unknown>;
      clack.log.success(`Sandbox: ${result.status ?? "ok"}`);
    } catch (err) {
      clack.log.warn("Could not restart sandbox — it will start on first message.");
      clack.log.info(chalk.dim(`${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // Success
  const botToken = clawrunEnv["CLAWRUN_TELEGRAM_BOT_TOKEN"];
  printSuccess(name, url, botToken ?? null);

  // Go straight into chat
  await startChat(name);
}

function printSuccess(name: string, url: string, botToken: string | null): void {
  clack.log.success(chalk.bold.green("Deployment successful!"));
  console.log(`  ${chalk.bold("Instance:")} ${chalk.cyan(name)}`);
  console.log(`  ${chalk.bold("URL:")} ${chalk.cyan(url)}`);
  console.log(`  ${chalk.bold("Health:")} ${chalk.cyan(`${url}/api/v1/health`)}`);

  if (botToken) {
    console.log(chalk.dim("\n  Your agent is live!"));
  }

  clack.outro("Done!");
}

async function startChat(name: string): Promise<void> {
  const freshConfig = readConfig(name);
  if (!freshConfig) {
    console.error(chalk.red(`Could not read config for "${name}".`));
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

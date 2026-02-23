import { command, positional, option, optional, string } from "cmd-ts";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as TOML from "@iarna/toml";
import { tmpdir } from "node:os";
import chalk from "chalk";
import { humanId } from "human-id";
import * as clack from "@clack/prompts";
import { getPreset, listPresets } from "../presets/index.js";
import { getPlatformProvider } from "../platform/index.js";
import type { PlatformTier, PlatformLimits, ProjectHandle, StateStoreEntry } from "../platform/index.js";
import {
  createInstance,
  instanceExists,
  getInstance,
  instanceDir,
  saveDeployedUrl,
  upgradeInstance,
  buildConfig,
  toEnvVars,
  readConfig,
  readAgentConfigJson,
  generateSecret,
} from "../instance/index.js";
import { getChannelSecretDefinitions } from "@cloudclaw/channel";
import { yes } from "../args/yes.js";
import { startAgentChat } from "./agent.js";
import { printBanner } from "../banner.js";

function generateInstanceName(): string {
  return `cloudclaw-${humanId({ separator: "-", capitalize: false })}`;
}

// Default active duration from the Zod schema (600s = 10 min)
const DEFAULT_ACTIVE_DURATION_S = 600;

async function detectAndPrintTier(): Promise<{
  tier: PlatformTier;
  limits: PlatformLimits;
}> {
  const platform = getPlatformProvider();
  const tier = await platform.detectTier();
  const limits = await platform.getLimits(tier);
  const activeDurationMins = Math.round(DEFAULT_ACTIVE_DURATION_S / 60);

  if (tier === "hobby") {
    clack.log.info(
      `${chalk.bold("Vercel Hobby (free) plan detected")}\n` +
      chalk.dim(`  Heartbeat cron:    ${limits.heartbeatCron} (daily)\n`) +
      chalk.dim(`  Active duration:   ${activeDurationMins} minutes per session\n`) +
      chalk.dim("  Lifecycle mode:    webhook-driven"),
    );
  } else {
    clack.log.info(
      `${chalk.bold("Vercel Pro plan detected")}\n` +
      chalk.dim(`  Heartbeat cron:    ${limits.heartbeatCron} (every minute)\n`) +
      chalk.dim(`  Active duration:   ${activeDurationMins} minutes per session\n`) +
      chalk.dim("  Lifecycle mode:    heartbeat-driven"),
    );
  }

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
      console.error(
        chalk.red("Please specify a preset: cloudclaw deploy <preset>"),
      );
      console.error(
        chalk.dim(
          `  Available: ${presets.map((p) => p.id).join(", ")}`,
        ),
      );
      process.exit(1);
    }
  }

  const preset = getPreset(presetId);
  if (!preset) {
    const available = listPresets()
      .map((p) => p.id)
      .join(", ");
    console.error(
      chalk.red(`Unknown preset: "${presetId}". Available: ${available}`),
    );
    process.exit(1);
  }

  clack.intro(chalk.bold.cyan("CloudClaw Setup"));

  // Instance name
  const name = instanceName ?? generateInstanceName();
  clack.log.step(`Instance: ${chalk.bold(name)}`);
  clack.log.info(`Preset: ${preset.name} — ${preset.description}`);

  const platform = getPlatformProvider();

  // Check prerequisites
  await platform.checkPrerequisites();

  // Detect tier
  const { limits } = await detectAndPrintTier();
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

  // Redirect ZeroClaw config to instance directory (never touch ~/.zeroclaw/)
  const zcConfigDir = join(instanceDir(name), "zeroclaw");
  mkdirSync(zcConfigDir, { recursive: true });
  const prevConfigDir = process.env.ZEROCLAW_CONFIG_DIR;
  process.env.ZEROCLAW_CONFIG_DIR = zcConfigDir;

  // Memory backend
  let memoryBackend = "sqlite";
  const backends = napi.getMemoryBackends();

  if (!options.yes) {
    const selected = await clack.select({
      message: "Select agent memory backend",
      options: backends.map((b: { key: string; label: string }) => ({
        value: b.key,
        label: b.label,
      })),
      initialValue: "sqlite",
    });

    if (clack.isCancel(selected)) {
      clack.cancel("Setup cancelled.");
      process.exit(0);
    }

    memoryBackend = selected as string;
  }

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

  // Write memory backend into zeroclaw config.toml
  const configTomlPath = join(zcConfigDir, "config.toml");
  const tomlContent = readFileSync(configTomlPath, "utf-8");
  const parsed = TOML.parse(tomlContent);
  parsed.memory = { ...(parsed.memory as Record<string, unknown> ?? {}), backend: memoryBackend };
  writeFileSync(configTomlPath, TOML.stringify(parsed as TOML.JsonMap));

  // Read the full assembled config from ZeroClaw
  const agentConfigJson = await napi.getSavedConfig();

  // Write agent config JSON to instance's zeroclaw/ dir (deployed alongside the app)
  writeFileSync(join(zcConfigDir, "config.json"), agentConfigJson);

  // Restore ZEROCLAW_CONFIG_DIR
  if (prevConfigDir !== undefined) process.env.ZEROCLAW_CONFIG_DIR = prevConfigDir;
  else delete process.env.ZEROCLAW_CONFIG_DIR;

  // CloudClaw-specific settings
  const activeDuration = defaultActiveDuration;
  const cronSecret = generateSecret();
  const nextAuthSecret = generateSecret();
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
    clack.log.error(`Failed to create project: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // Temp dir for integration provisioning
  const tempDir = join(tmpdir(), `cloudclaw-setup-${name}-${Date.now()}`);
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
    nextAuthSecret,
    webhookSecrets,
    sandboxSecret,
    provider: platform.id,
  });

  // Derive env vars from config + agent config JSON
  const cloudclawEnv = toEnvVars(config, agentConfigJson);
  const allEnvVars: Record<string, string> = {
    ...cloudclawEnv,
    ...stateResult.vars,
  };

  const dir = await createInstance(name, config, allEnvVars);

  // Write the project link
  platform.writeProjectLink(dir, handle);

  // Patch platform config with plan-aware cron schedule
  platform.patchPlatformConfig(dir, limits);

  // Disable deployment protection
  await platform.disableDeploymentProtection(dir);

  // Persist all env vars to project
  await platform.persistEnvVars(dir, allEnvVars);

  // Deploy
  const url = await platform.deploy(dir, allEnvVars);
  saveDeployedUrl(name, url);

  // Start sandbox
  clack.log.step("Starting sandbox...");
  if (cronSecret) {
    try {
      const res = await fetch(`${url}/api/v1/sandbox/restart`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cronSecret}` },
      });
      const result = await res.json() as Record<string, unknown>;
      clack.log.success(`Sandbox: ${result.status ?? "ok"}`);
    } catch {
      clack.log.warn("Could not start sandbox — it will start on first message.");
    }
  }

  // Success
  const botToken = allEnvVars["CLOUDCLAW_TELEGRAM_BOT_TOKEN"];
  printSuccess(name, url, botToken);

  await offerChat(name);
}

async function handleExistingInstance(
  name: string,
  options: { yes?: boolean },
): Promise<void> {
  const meta = getInstance(name);
  if (!meta) {
    console.error(chalk.red(`Instance "${name}" not found.`));
    process.exit(1);
  }

  const dir = instanceDir(name);

  clack.intro(chalk.bold.cyan(`Redeploying: ${name}`));
  clack.log.info(`Preset: ${meta.preset} | App: ${meta.appVersion}`);
  if (meta.deployedUrl) {
    clack.log.info(`Last deployed to: ${meta.deployedUrl}`);
  }

  const platform = getPlatformProvider();

  // Check prerequisites
  await platform.checkPrerequisites();

  // Detect tier
  const { limits } = await detectAndPrintTier();

  // Offer reconfiguration — two separate yes/no prompts
  // (napi may or may not be loaded depending on user choices)
  if (!options.yes) {
    const zcConfigDir = join(instanceDir(name), "zeroclaw");
    mkdirSync(zcConfigDir, { recursive: true });

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
      process.env.ZEROCLAW_CONFIG_DIR = zcConfigDir;
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
      process.env.ZEROCLAW_CONFIG_DIR = zcConfigDir;

      // Show currently configured channels before the wizard
      try {
        const currentJson = await napi!.getSavedConfig();
        const current = JSON.parse(currentJson);
        const cc = current.channels_config;
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
  }

  // Upgrade instance
  await upgradeInstance(name);

  // Patch platform config
  platform.patchPlatformConfig(dir, limits);

  // Read config
  const config = readConfig(name);
  if (!config) {
    clack.log.error(`No cloudclaw.json found for instance "${name}".`);
    process.exit(1);
  }

  // Read fresh agent config from config.toml (picks up edits + reconfiguration)
  const agentConfigJson = await readAgentConfigJson(name);

  // Write agent config JSON to instance's zeroclaw/ dir (deployed alongside the app)
  const zcDir = join(instanceDir(name), "zeroclaw");
  mkdirSync(zcDir, { recursive: true });
  writeFileSync(join(zcDir, "config.json"), agentConfigJson);

  const cloudclawEnv = toEnvVars(config, agentConfigJson);

  // Persist env vars
  await platform.persistEnvVars(dir, cloudclawEnv);

  // Deploy
  const url = await platform.deploy(dir, cloudclawEnv);
  saveDeployedUrl(name, url);

  // Restart sandbox
  clack.log.step("Restarting sandbox...");
  const cronSecret = cloudclawEnv["CLOUDCLAW_CRON_SECRET"];
  if (cronSecret) {
    try {
      const res = await fetch(`${url}/api/v1/sandbox/restart`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cronSecret}` },
      });
      const result = await res.json() as Record<string, unknown>;
      clack.log.success(`Sandbox: ${result.status ?? "ok"}`);
    } catch (err) {
      clack.log.warn("Could not restart sandbox — it will start on first message.");
      clack.log.info(chalk.dim(`${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // Success
  const botToken = cloudclawEnv["CLOUDCLAW_TELEGRAM_BOT_TOKEN"];
  printSuccess(name, url, botToken ?? null);

  await offerChat(name);
}

function printSuccess(
  name: string,
  url: string,
  botToken: string | null,
): void {
  clack.log.success(chalk.bold.green("Deployment successful!"));
  console.log(`  ${chalk.bold("Instance:")} ${chalk.cyan(name)}`);
  console.log(`  ${chalk.bold("URL:")} ${chalk.cyan(url)}`);
  console.log(`  ${chalk.bold("Health:")} ${chalk.cyan(`${url}/api/v1/health`)}`);

  if (botToken) {
    console.log(
      chalk.dim(
        "\n  Your agent is live!",
      ),
    );
  }

  clack.outro("Done!");
}

async function offerChat(name: string): Promise<void> {
  const chat = await clack.confirm({
    message: "Start chatting with your agent?",
    initialValue: true,
  });

  if (clack.isCancel(chat) || !chat) return;

  const freshConfig = readConfig(name);
  if (!freshConfig) {
    console.error(chalk.red(`Could not read config for "${name}".`));
    return;
  }

  await startAgentChat(name, freshConfig);
}

export const deploy = command({
  name: "deploy",
  description: "Create or upgrade and deploy an instance",
  args: {
    nameOrPreset: positional({ type: optional(string), displayName: "name", description: "Instance name or preset" }),
    yes,
    preset: option({ long: "preset", short: "p", type: optional(string), description: "Preset to use" }),
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

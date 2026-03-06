import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeSetupConfig, readSetup } from "./config.js";
import { schemaDefaults } from "zeroclaw";
import * as TOML from "@iarna/toml";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentSetupData, ChannelInfo } from "@clawrun/agent";

// --- helpers ---

function makeData(overrides: Partial<AgentSetupData> = {}): AgentSetupData {
  return {
    provider: {
      provider: "openrouter",
      apiKey: "sk-test-key",
      model: "anthropic/claude-sonnet-4",
      ...overrides.provider,
    },
    channels: overrides.channels ?? {},
  };
}

const telegramChannel: ChannelInfo = {
  id: "telegram",
  name: "Telegram",
  apiDomains: ["api.telegram.org"],
  setupFields: [
    { name: "bot_token", label: "Bot Token", type: "password", required: true },
    { name: "allowed_users", label: "Allowed Users", type: "list", required: false, default: "*" },
    { name: "webhook_port", label: "Webhook Port", type: "text", required: false, default: "8443" },
  ],
};

let dir: string;

function writeAndParse(data?: AgentSetupData, channels: ChannelInfo[] = []): TOML.JsonMap {
  writeSetupConfig(dir, data ?? makeData(), channels);
  return TOML.parse(readFileSync(join(dir, "config.toml"), "utf-8"));
}

/** Write structured TOML to simulate existing on-disk config. */
function writeExisting(obj: TOML.JsonMap): void {
  writeFileSync(join(dir, "config.toml"), TOML.stringify(obj));
}

// --- setup ---

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "config-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// --- tests ---

describe("writeSetupConfig — fresh deploy", () => {
  it("includes zeroclaw forbidden_paths from schema defaults", () => {
    const config = writeAndParse();
    const autonomy = config.autonomy as TOML.JsonMap;
    expect(autonomy.forbidden_paths).toEqual(
      (schemaDefaults.autonomy as Record<string, unknown>).forbidden_paths,
    );
  });

  it("overrides autonomy.level to full (zeroclaw default is supervised)", () => {
    const config = writeAndParse();
    expect((config.autonomy as TOML.JsonMap).level).toBe("full");
  });

  it("uses clawrun allowed_commands, not zeroclaw defaults", () => {
    const config = writeAndParse();
    const cmds = (config.autonomy as TOML.JsonMap).allowed_commands as string[];
    const schemaCmds = (schemaDefaults.autonomy as Record<string, unknown>)
      .allowed_commands as string[];
    expect(cmds).not.toEqual(schemaCmds);
  });

  it("overrides browser.enabled to true (zeroclaw default is false)", () => {
    const config = writeAndParse();
    expect((config.browser as TOML.JsonMap).enabled).toBe(true);
  });

  it("sets memory.backend to sqlite and auto_save to true", () => {
    const config = writeAndParse();
    const memory = config.memory as TOML.JsonMap;
    expect(memory.backend).toBe("sqlite");
    expect(memory.auto_save).toBe(true);
  });

  it("writes wizard provider values", () => {
    const config = writeAndParse();
    expect(config.api_key).toBe("sk-test-key");
    expect(config.default_provider).toBe("openrouter");
  });

  it("forces security.otp.enabled to false", () => {
    const config = writeAndParse();
    const otp = (config.security as TOML.JsonMap).otp as TOML.JsonMap;
    expect(otp.enabled).toBe(false);
  });

  it("includes zeroclaw schema defaults we do not override", () => {
    const config = writeAndParse();
    const agent = config.agent as TOML.JsonMap;
    expect(agent.max_tool_iterations).toBe(
      (schemaDefaults.agent as Record<string, unknown>).max_tool_iterations,
    );
  });

  it("omits api_url when not provided", () => {
    const config = writeAndParse(makeData());
    expect(config).not.toHaveProperty("api_url");
  });

  it("writes api_url when provided", () => {
    const data = makeData({
      provider: { provider: "openrouter", apiKey: "k", model: "m", apiUrl: "https://custom.api" },
    });
    const config = writeAndParse(data);
    expect(config.api_url).toBe("https://custom.api");
  });
});

describe("writeSetupConfig — redeploy", () => {
  it("preserves user-customized temperature", () => {
    const initial = writeAndParse();
    writeExisting({ ...initial, default_temperature: 0.9 } as TOML.JsonMap);

    const config = writeAndParse();
    expect(config.default_temperature).toBe(0.9);
  });

  it("preserves user-customized autonomy.level without losing forbidden_paths", () => {
    const initial = writeAndParse();
    const autonomy = { ...(initial.autonomy as TOML.JsonMap), level: "supervised" };
    writeExisting({ ...initial, autonomy } as TOML.JsonMap);

    const config = writeAndParse();
    expect((config.autonomy as TOML.JsonMap).level).toBe("supervised");
    expect(Array.isArray((config.autonomy as TOML.JsonMap).forbidden_paths)).toBe(true);
  });

  it("does not merge arrays — user array replaces ours entirely", () => {
    const initial = writeAndParse();
    const autonomy = { ...(initial.autonomy as TOML.JsonMap), allowed_commands: ["git", "ls"] };
    writeExisting({ ...initial, autonomy } as TOML.JsonMap);

    const config = writeAndParse();
    expect((config.autonomy as TOML.JsonMap).allowed_commands).toEqual(["git", "ls"]);
  });

  it("picks up new schema defaults not present in existing config", () => {
    // Simulate old config written before zeroclaw added allow_sensitive_file_reads.
    // This field is in schemaDefaults.autonomy but NOT in CLAWRUN_OVERRIDES.
    writeExisting({
      default_temperature: 0.7,
      api_key: "sk-old",
      default_provider: "openrouter",
      default_model: "anthropic/claude-sonnet-4",
      autonomy: {
        level: "full",
        workspace_only: true,
        allowed_commands: ["git", "ls"],
        forbidden_paths: ["/etc"],
        max_actions_per_hour: 500,
        max_cost_per_day_cents: 5000,
      },
    } as TOML.JsonMap);

    const config = writeAndParse();
    const autonomy = config.autonomy as TOML.JsonMap;
    // allow_sensitive_file_reads comes from schemaDefaults only — not in CLAWRUN_OVERRIDES
    expect(autonomy.allow_sensitive_file_reads).toBe(
      (schemaDefaults.autonomy as Record<string, unknown>).allow_sensitive_file_reads,
    );
  });

  it("otp stays forced false even if user set it to true", () => {
    const initial = writeAndParse();
    // Structured edit — no fragile string replace
    const security = initial.security as TOML.JsonMap;
    const otp = { ...(security.otp as TOML.JsonMap), enabled: true };
    writeExisting({ ...initial, security: { ...security, otp } } as TOML.JsonMap);

    const config = writeAndParse();
    expect(((config.security as TOML.JsonMap).otp as TOML.JsonMap).enabled).toBe(false);
  });

  it("preserves user edits to sections we do not override", () => {
    const initial = writeAndParse();
    const agent = { ...(initial.agent as TOML.JsonMap), max_tool_iterations: 50 };
    writeExisting({ ...initial, agent } as TOML.JsonMap);

    const config = writeAndParse();
    expect((config.agent as TOML.JsonMap).max_tool_iterations).toBe(50);
  });
});

describe("writeSetupConfig — channels", () => {
  it("writes channel fields into channels_config", () => {
    const data = makeData({
      channels: { telegram: { bot_token: "tok123", allowed_users: "user1, user2" } },
    });
    const config = writeAndParse(data, [telegramChannel]);
    const tg = (config.channels_config as TOML.JsonMap).telegram as TOML.JsonMap;
    expect(tg.bot_token).toBe("tok123");
  });

  it("splits list-type channel fields into arrays", () => {
    const data = makeData({
      channels: { telegram: { bot_token: "tok", allowed_users: "alice, bob, charlie" } },
    });
    const config = writeAndParse(data, [telegramChannel]);
    const tg = (config.channels_config as TOML.JsonMap).telegram as TOML.JsonMap;
    expect(tg.allowed_users).toEqual(["alice", "bob", "charlie"]);
  });

  it("coerces numeric channel field strings to numbers", () => {
    const data = makeData({
      channels: { telegram: { bot_token: "tok", webhook_port: "8443" } },
    });
    const config = writeAndParse(data, [telegramChannel]);
    const tg = (config.channels_config as TOML.JsonMap).telegram as TOML.JsonMap;
    expect(tg.webhook_port).toBe(8443);
  });

  it("sets cli = true in channels_config", () => {
    const data = makeData({
      channels: { telegram: { bot_token: "tok" } },
    });
    const config = writeAndParse(data, [telegramChannel]);
    expect((config.channels_config as TOML.JsonMap).cli).toBe(true);
  });

  it("updates channel fields on redeploy", () => {
    const data = makeData({
      channels: { telegram: { bot_token: "old-tok", allowed_users: "alice" } },
    });
    writeSetupConfig(dir, data, [telegramChannel]);

    const data2 = makeData({
      channels: { telegram: { bot_token: "new-tok", allowed_users: "alice, bob" } },
    });
    const config = writeAndParse(data2, [telegramChannel]);
    const tg = (config.channels_config as TOML.JsonMap).telegram as TOML.JsonMap;
    expect(tg.bot_token).toBe("new-tok");
  });
});

describe("readSetup", () => {
  it("returns null when no config.toml exists", () => {
    expect(readSetup(dir)).toBeNull();
  });

  it("extracts provider fields from existing config", () => {
    writeAndParse();
    const setup = readSetup(dir);
    expect(setup?.provider?.provider).toBe("openrouter");
    expect(setup?.provider?.apiKey).toBe("sk-test-key");
  });

  it("extracts channel array fields as comma-separated strings", () => {
    const data = makeData({
      channels: { telegram: { bot_token: "tok", allowed_users: "alice, bob" } },
    });
    writeSetupConfig(dir, data, [telegramChannel]);

    const setup = readSetup(dir);
    expect(setup?.channels?.telegram?.allowed_users).toBe("alice, bob");
  });

  it("excludes cli from channel output", () => {
    const data = makeData({ channels: { telegram: { bot_token: "t" } } });
    writeSetupConfig(dir, data, [telegramChannel]);

    const setup = readSetup(dir);
    expect(setup?.channels).not.toHaveProperty("cli");
  });
});

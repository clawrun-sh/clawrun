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
  it("clears forbidden_paths for sandbox (defaults block /home and /tmp)", () => {
    const config = writeAndParse();
    const autonomy = config.autonomy as TOML.JsonMap;
    expect(autonomy.forbidden_paths).toEqual([]);
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
    // Base commands are hardcoded; tool-specific commands (agent-browser, gh, skills)
    // are injected dynamically at boot from Tool.skillContent.
    expect(cmds).toContain("git");
    expect(cmds).toContain("make");
  });

  it("clears non_cli_excluded_tools so all tools work from all channels", () => {
    const config = writeAndParse();
    expect((config.autonomy as TOML.JsonMap).non_cli_excluded_tools).toEqual([]);
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
    // safety_heartbeat_interval is a schema default we don't override
    expect(agent.safety_heartbeat_interval).toBe(
      (schemaDefaults.agent as Record<string, unknown>).safety_heartbeat_interval,
    );
  });

  it("overrides max_tool_iterations to 50 (schema default is 20)", () => {
    const config = writeAndParse();
    const agent = config.agent as TOML.JsonMap;
    expect(agent.max_tool_iterations).toBe(50);
  });

  it("limits max_history_messages to 20 (prevents context overflow from browser snapshots)", () => {
    const config = writeAndParse();
    const agent = config.agent as TOML.JsonMap;
    expect(agent.max_history_messages).toBe(20);
  });

  it("limits session.max_messages to 30", () => {
    const config = writeAndParse();
    const session = (config.agent as TOML.JsonMap).session as TOML.JsonMap;
    expect(session.max_messages).toBe(30);
  });

  it("enables web_fetch with wildcard domains", () => {
    const config = writeAndParse();
    const webFetch = config.web_fetch as TOML.JsonMap;
    expect(webFetch.enabled).toBe(true);
    expect(webFetch.allowed_domains).toEqual(["*"]);
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

describe("writeSetupConfig — redeploy (existing config wins)", () => {
  it("preserves user-customized temperature", () => {
    const initial = writeAndParse();
    writeExisting({ ...initial, default_temperature: 0.9 } as TOML.JsonMap);

    const config = writeAndParse();
    expect(config.default_temperature).toBe(0.9);
  });

  it("preserves user-customized autonomy.level", () => {
    const initial = writeAndParse();
    const autonomy = { ...(initial.autonomy as TOML.JsonMap), level: "supervised" };
    writeExisting({ ...initial, autonomy } as TOML.JsonMap);

    const config = writeAndParse();
    expect((config.autonomy as TOML.JsonMap).level).toBe("supervised");
  });

  it("preserves user-customized allowed_commands", () => {
    const initial = writeAndParse();
    const autonomy = { ...(initial.autonomy as TOML.JsonMap), allowed_commands: ["git", "ls"] };
    writeExisting({ ...initial, autonomy } as TOML.JsonMap);

    const config = writeAndParse();
    const cmds = (config.autonomy as TOML.JsonMap).allowed_commands as string[];
    // User edits win — they chose to restrict commands
    expect(cmds).toEqual(["git", "ls"]);
  });

  it("preserves user-customized forbidden_paths", () => {
    const initial = writeAndParse();
    const autonomy = {
      ...(initial.autonomy as TOML.JsonMap),
      forbidden_paths: ["/etc", "/root"],
    };
    writeExisting({ ...initial, autonomy } as TOML.JsonMap);

    const config = writeAndParse();
    expect((config.autonomy as TOML.JsonMap).forbidden_paths).toEqual(["/etc", "/root"]);
  });

  it("preserves user-customized non_cli_excluded_tools", () => {
    const initial = writeAndParse();
    const autonomy = {
      ...(initial.autonomy as TOML.JsonMap),
      non_cli_excluded_tools: ["browser", "shell"],
    };
    writeExisting({ ...initial, autonomy } as TOML.JsonMap);

    const config = writeAndParse();
    expect((config.autonomy as TOML.JsonMap).non_cli_excluded_tools).toEqual(["browser", "shell"]);
  });

  it("picks up new schema defaults not present in existing config", () => {
    // Simulate old config written before zeroclaw added allow_sensitive_file_reads.
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
    // allow_sensitive_file_reads comes from schemaDefaults — fills gaps in existing config
    expect(autonomy.allow_sensitive_file_reads).toBe(
      (schemaDefaults.autonomy as Record<string, unknown>).allow_sensitive_file_reads,
    );
  });

  it("preserves user-customized otp setting", () => {
    const initial = writeAndParse();
    const security = initial.security as TOML.JsonMap;
    const otp = { ...(security.otp as TOML.JsonMap), enabled: true };
    writeExisting({ ...initial, security: { ...security, otp } } as TOML.JsonMap);

    const config = writeAndParse();
    // User edits win
    expect(((config.security as TOML.JsonMap).otp as TOML.JsonMap).enabled).toBe(true);
  });

  it("preserves user edits to agent section", () => {
    const initial = writeAndParse();
    const agent = { ...(initial.agent as TOML.JsonMap), max_tool_iterations: 100 };
    writeExisting({ ...initial, agent } as TOML.JsonMap);

    const config = writeAndParse();
    expect((config.agent as TOML.JsonMap).max_tool_iterations).toBe(100);
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

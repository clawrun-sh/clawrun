import { describe, it, expect } from "vitest";
import { SANDBOX_DEFAULTS, clawRunConfigSchema } from "./schema.js";

describe("SANDBOX_DEFAULTS", () => {
  it("has activeDuration of 300", () => {
    expect(SANDBOX_DEFAULTS.activeDuration).toBe(300);
  });

  it("has cronKeepAliveWindow of 900", () => {
    expect(SANDBOX_DEFAULTS.cronKeepAliveWindow).toBe(900);
  });

  it("has cronWakeLeadTime of 60", () => {
    expect(SANDBOX_DEFAULTS.cronWakeLeadTime).toBe(60);
  });

  it("has vcpus of 2", () => {
    expect(SANDBOX_DEFAULTS.vcpus).toBe(2);
  });
});

describe("clawRunConfigSchema — instance defaults", () => {
  const minInput = {
    instance: { provider: "vercel", name: "test", deployedUrl: "https://test.vercel.app" },
    agent: { name: "zeroclaw" },
    sandbox: {},
  };

  it("requires instance.name", () => {
    const { name: _, ...noName } = minInput.instance;
    expect(() => clawRunConfigSchema.parse({ ...minInput, instance: noName })).toThrow();
  });

  it("requires instance.deployedUrl", () => {
    const { deployedUrl: _, ...noUrl } = minInput.instance;
    expect(() => clawRunConfigSchema.parse({ ...minInput, instance: noUrl })).toThrow();
  });

  it("defaults instance.sandboxRoot to '.clawrun'", () => {
    const parsed = clawRunConfigSchema.parse(minInput);
    expect(parsed.instance.sandboxRoot).toBe(".clawrun");
  });

  it("leaves instance.preset as undefined when omitted", () => {
    const parsed = clawRunConfigSchema.parse(minInput);
    expect(parsed.instance.preset).toBeUndefined();
  });

  it("preserves explicitly provided instance.name", () => {
    const input = {
      ...minInput,
      instance: { ...minInput.instance, name: "my-instance" },
    };
    const parsed = clawRunConfigSchema.parse(input);
    expect(parsed.instance.name).toBe("my-instance");
  });
});

describe("clawRunConfigSchema — agent defaults", () => {
  const minInput = {
    instance: { provider: "vercel", name: "test", deployedUrl: "https://test.vercel.app" },
    agent: { name: "zeroclaw" },
    sandbox: {},
  };

  it("defaults agent.config to 'agent/config.toml'", () => {
    const parsed = clawRunConfigSchema.parse(minInput);
    expect(parsed.agent.config).toBe("agent/config.toml");
  });

  it("defaults agent.bundlePaths to empty array", () => {
    const parsed = clawRunConfigSchema.parse(minInput);
    expect(parsed.agent.bundlePaths).toEqual([]);
  });

  it("preserves explicitly provided agent.config", () => {
    const input = {
      ...minInput,
      agent: { ...minInput.agent, config: "custom/path.toml" },
    };
    const parsed = clawRunConfigSchema.parse(input);
    expect(parsed.agent.config).toBe("custom/path.toml");
  });
});

describe("clawRunConfigSchema — sandbox defaults from SANDBOX_DEFAULTS", () => {
  const minInput = {
    instance: { provider: "vercel", name: "test", deployedUrl: "https://test.vercel.app" },
    agent: { name: "zeroclaw" },
    sandbox: {},
  };

  it("defaults sandbox.activeDuration to SANDBOX_DEFAULTS.activeDuration", () => {
    const parsed = clawRunConfigSchema.parse(minInput);
    expect(parsed.sandbox.activeDuration).toBe(SANDBOX_DEFAULTS.activeDuration);
  });

  it("defaults sandbox.cronKeepAliveWindow to SANDBOX_DEFAULTS.cronKeepAliveWindow", () => {
    const parsed = clawRunConfigSchema.parse(minInput);
    expect(parsed.sandbox.cronKeepAliveWindow).toBe(SANDBOX_DEFAULTS.cronKeepAliveWindow);
  });

  it("defaults sandbox.cronWakeLeadTime to SANDBOX_DEFAULTS.cronWakeLeadTime", () => {
    const parsed = clawRunConfigSchema.parse(minInput);
    expect(parsed.sandbox.cronWakeLeadTime).toBe(SANDBOX_DEFAULTS.cronWakeLeadTime);
  });

  it("defaults sandbox.resources.vcpus to SANDBOX_DEFAULTS.vcpus", () => {
    const parsed = clawRunConfigSchema.parse(minInput);
    expect(parsed.sandbox.resources.vcpus).toBe(SANDBOX_DEFAULTS.vcpus);
  });

  it("defaults sandbox.networkPolicy to 'allow-all'", () => {
    const parsed = clawRunConfigSchema.parse(minInput);
    expect(parsed.sandbox.networkPolicy).toBe("allow-all");
  });
});

describe("clawRunConfigSchema — sandbox overrides", () => {
  const minInput = {
    instance: { provider: "vercel", name: "test", deployedUrl: "https://test.vercel.app" },
    agent: { name: "zeroclaw" },
    sandbox: {},
  };

  it("accepts custom activeDuration", () => {
    const input = { ...minInput, sandbox: { activeDuration: 300 } };
    const parsed = clawRunConfigSchema.parse(input);
    expect(parsed.sandbox.activeDuration).toBe(300);
  });

  it("accepts custom cronKeepAliveWindow", () => {
    const input = { ...minInput, sandbox: { cronKeepAliveWindow: 1200 } };
    const parsed = clawRunConfigSchema.parse(input);
    expect(parsed.sandbox.cronKeepAliveWindow).toBe(1200);
  });

  it("accepts custom cronWakeLeadTime", () => {
    const input = { ...minInput, sandbox: { cronWakeLeadTime: 120 } };
    const parsed = clawRunConfigSchema.parse(input);
    expect(parsed.sandbox.cronWakeLeadTime).toBe(120);
  });

  it("accepts custom vcpus", () => {
    const input = {
      ...minInput,
      sandbox: { resources: { vcpus: 4 } },
    };
    const parsed = clawRunConfigSchema.parse(input);
    expect(parsed.sandbox.resources.vcpus).toBe(4);
  });
});

describe("clawRunConfigSchema — vcpus validation", () => {
  const minInput = {
    instance: { provider: "vercel", name: "test", deployedUrl: "https://test.vercel.app" },
    agent: { name: "zeroclaw" },
    sandbox: {},
  };

  it("rejects vcpus less than 2", () => {
    const input = {
      ...minInput,
      sandbox: { resources: { vcpus: 1 } },
    };
    expect(() => clawRunConfigSchema.parse(input)).toThrow();
  });

  it("rejects vcpus greater than 8", () => {
    const input = {
      ...minInput,
      sandbox: { resources: { vcpus: 9 } },
    };
    expect(() => clawRunConfigSchema.parse(input)).toThrow();
  });

  it("accepts vcpus of exactly 2", () => {
    const input = {
      ...minInput,
      sandbox: { resources: { vcpus: 2 } },
    };
    const parsed = clawRunConfigSchema.parse(input);
    expect(parsed.sandbox.resources.vcpus).toBe(2);
  });

  it("accepts vcpus of exactly 8", () => {
    const input = {
      ...minInput,
      sandbox: { resources: { vcpus: 8 } },
    };
    const parsed = clawRunConfigSchema.parse(input);
    expect(parsed.sandbox.resources.vcpus).toBe(8);
  });

  it("rejects non-integer vcpus", () => {
    const input = {
      ...minInput,
      sandbox: { resources: { vcpus: 2.5 } },
    };
    expect(() => clawRunConfigSchema.parse(input)).toThrow();
  });
});

describe("clawRunConfigSchema — networkPolicy variants", () => {
  const minInput = {
    instance: { provider: "vercel", name: "test", deployedUrl: "https://test.vercel.app" },
    agent: { name: "zeroclaw" },
    sandbox: {},
  };

  it("accepts 'allow-all' network policy", () => {
    const input = { ...minInput, sandbox: { networkPolicy: "allow-all" } };
    const parsed = clawRunConfigSchema.parse(input);
    expect(parsed.sandbox.networkPolicy).toBe("allow-all");
  });

  it("accepts 'deny-all' network policy", () => {
    const input = { ...minInput, sandbox: { networkPolicy: "deny-all" } };
    const parsed = clawRunConfigSchema.parse(input);
    expect(parsed.sandbox.networkPolicy).toBe("deny-all");
  });

  it("accepts object network policy with allow array", () => {
    const input = {
      ...minInput,
      sandbox: { networkPolicy: { allow: ["api.example.com"] } },
    };
    const parsed = clawRunConfigSchema.parse(input);
    expect(
      typeof parsed.sandbox.networkPolicy === "object" && parsed.sandbox.networkPolicy.allow,
    ).toEqual(["api.example.com"]);
  });

  it("accepts object network policy with subnets", () => {
    const input = {
      ...minInput,
      sandbox: {
        networkPolicy: {
          subnets: { allow: ["10.0.0.0/8"], deny: ["192.168.0.0/16"] },
        },
      },
    };
    const parsed = clawRunConfigSchema.parse(input);
    expect(
      typeof parsed.sandbox.networkPolicy === "object" &&
        parsed.sandbox.networkPolicy.subnets?.deny,
    ).toEqual(["192.168.0.0/16"]);
  });

  it("rejects invalid string network policy", () => {
    const input = {
      ...minInput,
      sandbox: { networkPolicy: "invalid-policy" },
    };
    expect(() => clawRunConfigSchema.parse(input)).toThrow();
  });
});

describe("clawRunConfigSchema — secrets", () => {
  const minInput = {
    instance: { provider: "vercel", name: "test", deployedUrl: "https://test.vercel.app" },
    agent: { name: "zeroclaw" },
    sandbox: {},
  };

  it("leaves secrets undefined when omitted", () => {
    const parsed = clawRunConfigSchema.parse(minInput);
    expect(parsed.secrets).toBeUndefined();
  });

  it("accepts secrets with all required fields", () => {
    const input = {
      ...minInput,
      secrets: {
        cronSecret: "cs",
        jwtSecret: "js",
        sandboxSecret: "ss",
      },
    };
    const parsed = clawRunConfigSchema.parse(input);
    expect(parsed.secrets?.cronSecret).toBe("cs");
  });

  it("accepts secrets with optional webhookSecrets", () => {
    const input = {
      ...minInput,
      secrets: {
        cronSecret: "cs",
        jwtSecret: "js",
        sandboxSecret: "ss",
        webhookSecrets: { telegram: "tg-secret" },
      },
    };
    const parsed = clawRunConfigSchema.parse(input);
    expect(parsed.secrets?.webhookSecrets?.telegram).toBe("tg-secret");
  });

  it("rejects secrets missing jwtSecret", () => {
    const input = {
      ...minInput,
      secrets: { cronSecret: "cs", sandboxSecret: "ss" },
    };
    expect(() => clawRunConfigSchema.parse(input)).toThrow();
  });

  it("rejects secrets missing sandboxSecret", () => {
    const input = {
      ...minInput,
      secrets: { cronSecret: "cs", jwtSecret: "js" },
    };
    expect(() => clawRunConfigSchema.parse(input)).toThrow();
  });
});

describe("clawRunConfigSchema — state", () => {
  const minInput = {
    instance: { provider: "vercel", name: "test", deployedUrl: "https://test.vercel.app" },
    agent: { name: "zeroclaw" },
    sandbox: {},
  };

  it("leaves state undefined when omitted", () => {
    const parsed = clawRunConfigSchema.parse(minInput);
    expect(parsed.state).toBeUndefined();
  });

  it("accepts state with redisUrl", () => {
    const input = {
      ...minInput,
      state: { redisUrl: "rediss://default:tok@redis.example.com:6379" },
    };
    const parsed = clawRunConfigSchema.parse(input);
    expect(parsed.state?.redisUrl).toBe("rediss://default:tok@redis.example.com:6379");
  });

  it("rejects state missing redisUrl", () => {
    const input = {
      ...minInput,
      state: {},
    };
    expect(() => clawRunConfigSchema.parse(input)).toThrow();
  });
});

describe("clawRunConfigSchema — required fields", () => {
  it("rejects input missing instance", () => {
    expect(() =>
      clawRunConfigSchema.parse({
        agent: { name: "zeroclaw" },
        sandbox: {},
      }),
    ).toThrow();
  });

  it("rejects input missing agent", () => {
    expect(() =>
      clawRunConfigSchema.parse({
        instance: { provider: "vercel", name: "test", deployedUrl: "https://test.vercel.app" },
        sandbox: {},
      }),
    ).toThrow();
  });

  it("rejects input missing sandbox", () => {
    expect(() =>
      clawRunConfigSchema.parse({
        instance: { provider: "vercel", name: "test", deployedUrl: "https://test.vercel.app" },
        agent: { name: "zeroclaw" },
      }),
    ).toThrow();
  });

  it("rejects input missing instance.provider", () => {
    expect(() =>
      clawRunConfigSchema.parse({
        instance: { name: "test", deployedUrl: "https://test.vercel.app" },
        agent: { name: "zeroclaw" },
        sandbox: {},
      }),
    ).toThrow();
  });

  it("rejects input missing agent.name", () => {
    expect(() =>
      clawRunConfigSchema.parse({
        instance: { provider: "vercel", name: "test", deployedUrl: "https://test.vercel.app" },
        agent: {},
        sandbox: {},
      }),
    ).toThrow();
  });
});

describe("clawRunConfigSchema — $schema field", () => {
  const minInput = {
    instance: { provider: "vercel", name: "test", deployedUrl: "https://test.vercel.app" },
    agent: { name: "zeroclaw" },
    sandbox: {},
  };

  it("accepts optional $schema field", () => {
    const input = { ...minInput, $schema: "https://clawrun.sh/schema.json" };
    const parsed = clawRunConfigSchema.parse(input);
    expect(parsed.$schema).toBe("https://clawrun.sh/schema.json");
  });

  it("leaves $schema undefined when omitted", () => {
    const parsed = clawRunConfigSchema.parse(minInput);
    expect(parsed.$schema).toBeUndefined();
  });
});

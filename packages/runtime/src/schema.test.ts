import { describe, it, expect } from "vitest";
import { SANDBOX_DEFAULTS, cloudClawConfigSchema } from "./schema.js";

describe("SANDBOX_DEFAULTS", () => {
  it("has activeDuration of 600", () => {
    expect(SANDBOX_DEFAULTS.activeDuration).toBe(600);
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

describe("cloudClawConfigSchema — instance defaults", () => {
  const minInput = {
    instance: { provider: "vercel" },
    agent: { name: "zeroclaw" },
    sandbox: {},
  };

  it("defaults instance.name to 'default'", () => {
    const parsed = cloudClawConfigSchema.parse(minInput);
    expect(parsed.instance.name).toBe("default");
  });

  it("defaults instance.sandboxRoot to '.clawrun'", () => {
    const parsed = cloudClawConfigSchema.parse(minInput);
    expect(parsed.instance.sandboxRoot).toBe(".clawrun");
  });

  it("leaves instance.preset as undefined when omitted", () => {
    const parsed = cloudClawConfigSchema.parse(minInput);
    expect(parsed.instance.preset).toBeUndefined();
  });

  it("leaves instance.deployedUrl as undefined when omitted", () => {
    const parsed = cloudClawConfigSchema.parse(minInput);
    expect(parsed.instance.deployedUrl).toBeUndefined();
  });

  it("preserves explicitly provided instance.name", () => {
    const input = {
      ...minInput,
      instance: { ...minInput.instance, name: "my-instance" },
    };
    const parsed = cloudClawConfigSchema.parse(input);
    expect(parsed.instance.name).toBe("my-instance");
  });
});

describe("cloudClawConfigSchema — agent defaults", () => {
  const minInput = {
    instance: { provider: "vercel" },
    agent: { name: "zeroclaw" },
    sandbox: {},
  };

  it("defaults agent.config to 'agent/config.toml'", () => {
    const parsed = cloudClawConfigSchema.parse(minInput);
    expect(parsed.agent.config).toBe("agent/config.toml");
  });

  it("defaults agent.bundlePaths to empty array", () => {
    const parsed = cloudClawConfigSchema.parse(minInput);
    expect(parsed.agent.bundlePaths).toEqual([]);
  });

  it("preserves explicitly provided agent.config", () => {
    const input = {
      ...minInput,
      agent: { ...minInput.agent, config: "custom/path.toml" },
    };
    const parsed = cloudClawConfigSchema.parse(input);
    expect(parsed.agent.config).toBe("custom/path.toml");
  });
});

describe("cloudClawConfigSchema — sandbox defaults from SANDBOX_DEFAULTS", () => {
  const minInput = {
    instance: { provider: "vercel" },
    agent: { name: "zeroclaw" },
    sandbox: {},
  };

  it("defaults sandbox.activeDuration to SANDBOX_DEFAULTS.activeDuration", () => {
    const parsed = cloudClawConfigSchema.parse(minInput);
    expect(parsed.sandbox.activeDuration).toBe(SANDBOX_DEFAULTS.activeDuration);
  });

  it("defaults sandbox.cronKeepAliveWindow to SANDBOX_DEFAULTS.cronKeepAliveWindow", () => {
    const parsed = cloudClawConfigSchema.parse(minInput);
    expect(parsed.sandbox.cronKeepAliveWindow).toBe(SANDBOX_DEFAULTS.cronKeepAliveWindow);
  });

  it("defaults sandbox.cronWakeLeadTime to SANDBOX_DEFAULTS.cronWakeLeadTime", () => {
    const parsed = cloudClawConfigSchema.parse(minInput);
    expect(parsed.sandbox.cronWakeLeadTime).toBe(SANDBOX_DEFAULTS.cronWakeLeadTime);
  });

  it("defaults sandbox.resources.vcpus to SANDBOX_DEFAULTS.vcpus", () => {
    const parsed = cloudClawConfigSchema.parse(minInput);
    expect(parsed.sandbox.resources.vcpus).toBe(SANDBOX_DEFAULTS.vcpus);
  });

  it("defaults sandbox.networkPolicy to 'allow-all'", () => {
    const parsed = cloudClawConfigSchema.parse(minInput);
    expect(parsed.sandbox.networkPolicy).toBe("allow-all");
  });
});

describe("cloudClawConfigSchema — sandbox overrides", () => {
  const minInput = {
    instance: { provider: "vercel" },
    agent: { name: "zeroclaw" },
    sandbox: {},
  };

  it("accepts custom activeDuration", () => {
    const input = { ...minInput, sandbox: { activeDuration: 300 } };
    const parsed = cloudClawConfigSchema.parse(input);
    expect(parsed.sandbox.activeDuration).toBe(300);
  });

  it("accepts custom cronKeepAliveWindow", () => {
    const input = { ...minInput, sandbox: { cronKeepAliveWindow: 1200 } };
    const parsed = cloudClawConfigSchema.parse(input);
    expect(parsed.sandbox.cronKeepAliveWindow).toBe(1200);
  });

  it("accepts custom cronWakeLeadTime", () => {
    const input = { ...minInput, sandbox: { cronWakeLeadTime: 120 } };
    const parsed = cloudClawConfigSchema.parse(input);
    expect(parsed.sandbox.cronWakeLeadTime).toBe(120);
  });

  it("accepts custom vcpus", () => {
    const input = {
      ...minInput,
      sandbox: { resources: { vcpus: 4 } },
    };
    const parsed = cloudClawConfigSchema.parse(input);
    expect(parsed.sandbox.resources.vcpus).toBe(4);
  });
});

describe("cloudClawConfigSchema — vcpus validation", () => {
  const minInput = {
    instance: { provider: "vercel" },
    agent: { name: "zeroclaw" },
    sandbox: {},
  };

  it("rejects vcpus less than 2", () => {
    const input = {
      ...minInput,
      sandbox: { resources: { vcpus: 1 } },
    };
    expect(() => cloudClawConfigSchema.parse(input)).toThrow();
  });

  it("rejects vcpus greater than 8", () => {
    const input = {
      ...minInput,
      sandbox: { resources: { vcpus: 9 } },
    };
    expect(() => cloudClawConfigSchema.parse(input)).toThrow();
  });

  it("accepts vcpus of exactly 2", () => {
    const input = {
      ...minInput,
      sandbox: { resources: { vcpus: 2 } },
    };
    const parsed = cloudClawConfigSchema.parse(input);
    expect(parsed.sandbox.resources.vcpus).toBe(2);
  });

  it("accepts vcpus of exactly 8", () => {
    const input = {
      ...minInput,
      sandbox: { resources: { vcpus: 8 } },
    };
    const parsed = cloudClawConfigSchema.parse(input);
    expect(parsed.sandbox.resources.vcpus).toBe(8);
  });

  it("rejects non-integer vcpus", () => {
    const input = {
      ...minInput,
      sandbox: { resources: { vcpus: 2.5 } },
    };
    expect(() => cloudClawConfigSchema.parse(input)).toThrow();
  });
});

describe("cloudClawConfigSchema — networkPolicy variants", () => {
  const minInput = {
    instance: { provider: "vercel" },
    agent: { name: "zeroclaw" },
    sandbox: {},
  };

  it("accepts 'allow-all' network policy", () => {
    const input = { ...minInput, sandbox: { networkPolicy: "allow-all" } };
    const parsed = cloudClawConfigSchema.parse(input);
    expect(parsed.sandbox.networkPolicy).toBe("allow-all");
  });

  it("accepts 'deny-all' network policy", () => {
    const input = { ...minInput, sandbox: { networkPolicy: "deny-all" } };
    const parsed = cloudClawConfigSchema.parse(input);
    expect(parsed.sandbox.networkPolicy).toBe("deny-all");
  });

  it("accepts object network policy with allow array", () => {
    const input = {
      ...minInput,
      sandbox: { networkPolicy: { allow: ["api.example.com"] } },
    };
    const parsed = cloudClawConfigSchema.parse(input);
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
    const parsed = cloudClawConfigSchema.parse(input);
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
    expect(() => cloudClawConfigSchema.parse(input)).toThrow();
  });
});

describe("cloudClawConfigSchema — secrets", () => {
  const minInput = {
    instance: { provider: "vercel" },
    agent: { name: "zeroclaw" },
    sandbox: {},
  };

  it("leaves secrets undefined when omitted", () => {
    const parsed = cloudClawConfigSchema.parse(minInput);
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
    const parsed = cloudClawConfigSchema.parse(input);
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
    const parsed = cloudClawConfigSchema.parse(input);
    expect(parsed.secrets?.webhookSecrets?.telegram).toBe("tg-secret");
  });

  it("rejects secrets missing jwtSecret", () => {
    const input = {
      ...minInput,
      secrets: { cronSecret: "cs", sandboxSecret: "ss" },
    };
    expect(() => cloudClawConfigSchema.parse(input)).toThrow();
  });

  it("rejects secrets missing sandboxSecret", () => {
    const input = {
      ...minInput,
      secrets: { cronSecret: "cs", jwtSecret: "js" },
    };
    expect(() => cloudClawConfigSchema.parse(input)).toThrow();
  });
});

describe("cloudClawConfigSchema — state", () => {
  const minInput = {
    instance: { provider: "vercel" },
    agent: { name: "zeroclaw" },
    sandbox: {},
  };

  it("leaves state undefined when omitted", () => {
    const parsed = cloudClawConfigSchema.parse(minInput);
    expect(parsed.state).toBeUndefined();
  });

  it("accepts state with required url and token", () => {
    const input = {
      ...minInput,
      state: { url: "https://redis.example.com", token: "tok" },
    };
    const parsed = cloudClawConfigSchema.parse(input);
    expect(parsed.state?.url).toBe("https://redis.example.com");
  });

  it("accepts state with optional readOnlyToken", () => {
    const input = {
      ...minInput,
      state: {
        url: "https://redis.example.com",
        token: "tok",
        readOnlyToken: "ro",
      },
    };
    const parsed = cloudClawConfigSchema.parse(input);
    expect(parsed.state?.readOnlyToken).toBe("ro");
  });

  it("accepts state with optional kvUrl", () => {
    const input = {
      ...minInput,
      state: {
        url: "https://redis.example.com",
        token: "tok",
        kvUrl: "https://kv.example.com",
      },
    };
    const parsed = cloudClawConfigSchema.parse(input);
    expect(parsed.state?.kvUrl).toBe("https://kv.example.com");
  });

  it("rejects state missing token", () => {
    const input = {
      ...minInput,
      state: { url: "https://redis.example.com" },
    };
    expect(() => cloudClawConfigSchema.parse(input)).toThrow();
  });
});

describe("cloudClawConfigSchema — required fields", () => {
  it("rejects input missing instance", () => {
    expect(() =>
      cloudClawConfigSchema.parse({
        agent: { name: "zeroclaw" },
        sandbox: {},
      }),
    ).toThrow();
  });

  it("rejects input missing agent", () => {
    expect(() =>
      cloudClawConfigSchema.parse({
        instance: { provider: "vercel" },
        sandbox: {},
      }),
    ).toThrow();
  });

  it("rejects input missing sandbox", () => {
    expect(() =>
      cloudClawConfigSchema.parse({
        instance: { provider: "vercel" },
        agent: { name: "zeroclaw" },
      }),
    ).toThrow();
  });

  it("rejects input missing instance.provider", () => {
    expect(() =>
      cloudClawConfigSchema.parse({
        instance: { name: "test" },
        agent: { name: "zeroclaw" },
        sandbox: {},
      }),
    ).toThrow();
  });

  it("rejects input missing agent.name", () => {
    expect(() =>
      cloudClawConfigSchema.parse({
        instance: { provider: "vercel" },
        agent: {},
        sandbox: {},
      }),
    ).toThrow();
  });
});

describe("cloudClawConfigSchema — $schema field", () => {
  const minInput = {
    instance: { provider: "vercel" },
    agent: { name: "zeroclaw" },
    sandbox: {},
  };

  it("accepts optional $schema field", () => {
    const input = { ...minInput, $schema: "https://clawrun.sh/schema.json" };
    const parsed = cloudClawConfigSchema.parse(input);
    expect(parsed.$schema).toBe("https://clawrun.sh/schema.json");
  });

  it("leaves $schema undefined when omitted", () => {
    const parsed = cloudClawConfigSchema.parse(minInput);
    expect(parsed.$schema).toBeUndefined();
  });
});

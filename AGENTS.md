# AGENTS.md — Agent Interface & Implementation Guide

## Agent Interface

Defined in `packages/agent/src/types.ts`. Every agent adapter must implement this interface.

```typescript
interface Agent {
  readonly id: string;
  readonly name: string;
  readonly channelsConfigKey: string;
  readonly daemonPort: number;

  // Sandbox lifecycle
  provision(sandbox, root, opts: ProvisionOpts): Promise<void>;
  getDaemonCommand(root, opts?): DaemonCommand;
  sendMessage(sandbox, root, message, opts?): Promise<AgentResponse>;
  listCronJobs(sandbox, root, opts?): Promise<CronJob[]>;
  getMonitorConfig(root): MonitorConfig;

  // Setup & configuration
  getProviders(): ProviderInfo[];
  getDefaultModel(provider: string): string;
  getCuratedModels(provider: string): CuratedModel[];
  getModelsFetchEndpoint(provider, apiUrl?): { url, authHeader } | null;
  getSupportedChannels(): ChannelInfo[];
  writeSetupConfig(agentDir, data: AgentSetupData): void;
  readSetup(agentDir): { provider?; channels? } | null;

  // Tools & bundling
  getEnabledTools(agentDir): Tool[];
  getToolDomains(agentDir): Tool[];
  getLocalOwnedFiles(): string[];
  getBundleFiles(): string[];
  getBinaryBundlePaths(): string[];
  getInstallDependencies(): Record<string, string>;
  getSeedDirectory(): string | null;
}
```

## Registration Pattern

Agent implementations self-register via a factory:

```typescript
// packages/agent-zeroclaw/src/register.ts
import { registerAgentFactory } from "@clawrun/agent";
import { ZeroclawAgent } from "./agent.js";

registerAgentFactory("zeroclaw", () => new ZeroclawAgent());
```

The runtime calls `createAgent(name)` which looks up the factory by name. Registration happens at import time — the CLI and server import the adapter packages to trigger it.

## Existing Implementations

### ZeroClaw (`@clawrun/agent-zeroclaw`)

- **Package**: `packages/agent-zeroclaw`
- **Agent ID**: `"zeroclaw"`
- **Daemon port**: 3000
- **Binary**: Single static linux-amd64 binary, provisioned into sandbox
- **Config format**: TOML (`config.toml`)
- **Messaging**: WebSocket to daemon, fallback to CLI one-shot
- **Providers**: OpenRouter, Anthropic, OpenAI, Google, Groq, Mistral, DeepSeek
- **Channels**: Telegram, Discord, Slack, WhatsApp, DingTalk, Lark, LinQ, Matrix, QQ

## Provider Interface

Defined in `packages/provider/src/types.ts`:

```typescript
interface SandboxProvider {
  create(opts: CreateSandboxOptions): Promise<ManagedSandbox>;
  get(id: string): Promise<ManagedSandbox>;
  list(): Promise<SandboxInfo[]>;
  listSnapshots(): Promise<SnapshotInfo[]>;
  deleteSnapshot(id: string): Promise<void>;
}

interface ManagedSandbox {
  readonly id: string;
  readonly status: string;
  readonly timeout: number;
  readonly createdAt: number;
  runCommand(cmd, args?): Promise<CommandResult>;
  updateNetworkPolicy(policy): Promise<void>;
  writeFiles(files): Promise<void>;
  readFile(path): Promise<Buffer | null>;
  stop(): Promise<void>;
  snapshot(): Promise<SnapshotRef>;
  extendTimeout(ms): Promise<void>;
  domain(port): string;
}
```

### Vercel Sandbox (`@clawrun/provider-vercel`)

- **Package**: `packages/provider-vercel`
- **Provider ID**: `"vercel"`
- **SDK**: `@vercel/sandbox`
- **Self-registers** via `register.ts`

## Channel Interface

Defined in `packages/channel/src/types.ts`. Each adapter registers itself.

9 adapters implemented: Telegram, Discord, Slack, WhatsApp, DingTalk, Lark, LinQ, Matrix, QQ.

## Adding a New Agent

1. Create `packages/agent-<name>/`
2. Implement the `Agent` interface
3. Add a `register.ts` that calls `registerAgentFactory("<name>", factory)`
4. Import the register module in the CLI and server entry points
5. Create a preset in `presets/` with `"agent": "<name>"`

## Adding a New Provider

1. Create `packages/provider-<name>/`
2. Implement `SandboxProvider` and `ManagedSandbox`
3. Add a `register.ts` that calls `registerProviderFactory("<name>", factory)`
4. Import the register module in the CLI entry point

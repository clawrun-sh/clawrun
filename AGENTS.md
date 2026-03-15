# AGENTS.md — Agent Interface & Implementation Guide

## Agent Interface

Defined in `packages/agent/src/types.ts`. Every agent implementation must implement this interface.

```typescript
interface Agent {
  readonly id: string;
  readonly name: string;
  readonly channelsConfigKey: string;
  readonly daemonPort: number;

  // Provisioning
  provision(sandbox, root, opts: ProvisionOpts): Promise<void>;

  // Messaging
  sendMessage(sandbox, root, message, opts?): Promise<AgentResponse>;
  streamMessage(sandbox, root, message, writer: UIMessageStreamWriter, opts?): Promise<void>;

  // Conversation threads
  listThreads(sandbox, root, opts?): Promise<ThreadInfo[]>;
  getThread(sandbox, root, threadId, opts?): Promise<UIMessage[]>;

  // Daemon and cron
  getDaemonCommand(root, opts?): DaemonCommand;
  listCronJobs(sandbox, root, opts?): Promise<CronJob[]>;

  // Tools
  getAvailableTools(): Tool[];
  getEnabledTools(agentDir): Tool[];
  getToolDomains(agentDir): Tool[];

  // Configuration and setup
  getMonitorConfig(root): MonitorConfig;
  getProviders(): ProviderInfo[];
  getDefaultModel(provider): string;
  getCuratedModels(provider): CuratedModel[];
  getModelsFetchEndpoint(provider, apiUrl?): { url, authHeader } | null;
  getSupportedChannels(): ChannelInfo[];
  writeSetupConfig(agentDir, data: AgentSetupData): void;
  readSetup(agentDir): { provider?; channels?; cost? } | null;

  // Bundling and dependencies
  getLocalOwnedFiles(): string[];
  getBundleFiles(): string[];
  getBinaryBundlePaths(): string[];
  getInstallDependencies(): Record<string, string>;
  getSeedDirectory(): string | null;

  // Dashboard API (called via daemon HTTP endpoints)
  getStatus(sandbox, root, opts?): Promise<AgentStatus>;
  getConfig(sandbox, root, opts?): Promise<AgentConfig>;
  listTools(sandbox, root, opts?): Promise<ToolsResult>;
  createCronJob(sandbox, root, job, opts?): Promise<CronJob>;
  deleteCronJob(sandbox, root, id, opts?): Promise<void>;
  listMemories(sandbox, root, query?, opts?): Promise<MemoryEntryInfo[]>;
  createMemory(sandbox, root, entry, opts?): Promise<void>;
  deleteMemory(sandbox, root, key, opts?): Promise<void>;
  getCostInfo(sandbox, root, opts?): Promise<CostInfo>;
  runDiagnostics(sandbox, root, opts?): Promise<DiagResult[]>;
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

The runtime calls `createAgent(name)` which looks up the factory by name. Registration happens at import time. The CLI and server import the adapter packages to trigger it.

## Existing Implementations

### ZeroClaw (`@clawrun/agent-zeroclaw`)

- **Package**: `packages/agent-zeroclaw`
- **Agent ID**: `"zeroclaw"`
- **Daemon port**: 3000
- **Binary**: Single static linux-amd64 binary, provisioned into sandbox
- **Config format**: TOML (`config.toml`)
- **Messaging**: WebSocket streaming to daemon (`/ws/clawrun`), fallback to CLI one-shot (`zeroclaw agent -m`)
- **Daemon command**: `zeroclaw daemon --port 3000 --host 0.0.0.0`
- **Providers**: 46 providers across recommended, fast, gateway, specialized, and local tiers (OpenRouter, Anthropic, OpenAI, Gemini, Groq, Mistral, DeepSeek, xAI, Ollama, and more)
- **Channels**: 20 channels in the catalog (Telegram, Discord, Slack, WhatsApp, Lark, QQ, Matrix, DingTalk, LinQ, and more)
- **Dashboard API**: All methods implemented via daemon HTTP endpoints (`/api/status`, `/api/config`, `/api/tools`, `/api/cost`, `/api/cron`, `/api/memory`, `/api/diagnostics`)

## Provider Interface

Defined in `packages/provider/src/types.ts`:

```typescript
interface SandboxProvider {
  create(opts: CreateSandboxOptions): Promise<ManagedSandbox>;
  get(id: SandboxId): Promise<ManagedSandbox>;
  list(): Promise<SandboxInfo[]>;
  listSnapshots(): Promise<SnapshotInfo[]>;
  deleteSnapshot(id: SnapshotId): Promise<void>;
}

interface ManagedSandbox {
  readonly id: SandboxId;
  readonly status: SandboxStatus;
  readonly timeout: number;
  readonly createdAt: number;
  runCommand(cmd, args?): Promise<CommandResult>;
  runCommand(opts: RunCommandOptions): Promise<CommandResult>;
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

Defined in `packages/channel/src/types.ts`:

```typescript
interface WakeHookAdapter {
  readonly channelId: string;
  readonly name: string;
  readonly programmableWebhook: boolean;
  readonly wakeResponseStatus: number;

  registerWebhook(webhookUrl): Promise<void>;
  deleteWebhook(): Promise<void>;
  verifyRequest(req, body): Promise<AuthResult>;
  handleChallenge?(req, body): Response | null;
  parseWakeSignal(body): WakeSignal | null;
  handleVerifyGet?(req): Response | null;
  sendMessage(chatId, message): Promise<void>;
}
```

6 wake-hook adapters registered: Telegram, Discord, Slack, WhatsApp, Lark, QQ. Additional channels (DingTalk, LinQ, Matrix, and others) have validators but no wake-hook adapters yet.

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

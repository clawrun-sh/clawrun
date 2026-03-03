# CLAUDE.md — ClawRun

## What This Is

ClawRun is a **hosting and lifecycle layer** for open-source AI agents. It deploys agents into Firecracker microVMs (Vercel Sandbox) and manages their full lifecycle — startup, heartbeat keep-alive, snapshot/resume, graceful shutdown, and wake-on-message.

**ClawRun does NOT build its own agent.** It hosts existing ones. ZeroClaw is the default agent; the `Agent` interface makes it pluggable.

The architecture is a **persistent sandbox** model: the agent daemon runs continuously inside a sandbox, receives messages via its own HTTP server, and ClawRun manages the sandbox TTL, snapshotting, and wake/sleep cycle around it.

## Repo Structure

```
cloudclaw/
├── CLAUDE.md
├── AGENTS.md
├── packages/
│   ├── cli/              # `clawrun` CLI — deploy, manage, connect to instances
│   ├── server/           # Next.js app: API routes, handlers, UI, templates
│   ├── runtime/          # Sandbox lifecycle, sidecar, storage, config
│   ├── agent/            # Agent interface + registry (abstract)
│   ├── agent-zeroclaw/   # ZeroClaw agent adapter (implements Agent)
│   ├── provider/         # SandboxProvider interface (abstract)
│   ├── provider-vercel/  # Vercel Sandbox provider (implements SandboxProvider)
│   ├── channel/          # WakeHookAdapter interface + 9 channel adapters
│   ├── auth/             # JWT auth primitives (jose)
│   ├── logger/           # Structured logging (consola)
│   ├── ui/               # React UI component library (Radix, shadcn, Tailwind)
│   ├── zeroclaw/         # ZeroClaw TS wrapper (binary mgmt, config gen, command building)
│   └── tsconfig/         # Shared TS config
├── presets/
│   └── starter/          # Default preset: ZeroClaw + Vercel
├── workspace-templates/  # Seeded workspace files (AGENTS.md, BOOTSTRAP.md, etc.)
└── notes/                # Architecture notes and comparisons
```

## Package Responsibilities

### `packages/cli` (`clawrun`)
CLI tool for deploying and managing agent instances. Commands:
- `deploy` — scaffold + deploy a new instance
- `list` / `ls` — show all instances
- `start` / `stop` — manage sandbox lifecycle
- `agent` — send messages to the agent
- `connect` — open a shell inside the sandbox
- `logs` — view/follow instance logs
- `pull` — pull agent state from sandbox to local
- `destroy` — remove an instance
- `invite` — manage invites
- `web` — open web dashboard

Uses `cmd-ts` for CLI framework, `@clack/prompts` for interactive prompts, `execa` for shelling out.

### `packages/server` (`@clawrun/server`)
Next.js app that gets deployed per instance. Exports:
- **Handlers**: health, heartbeat, sandbox start/stop/restart/heartbeat, webhook-wake, chat, accept
- **Config**: `createNextConfig()` — generates Next.js config with proper `outputFileTracingIncludes` for bundling sidecar scripts, agent binaries, and config files
- **Setup**: `setupServer()` — initializes lifecycle hooks and channel adapters
- **UI**: React pages and components for web chat, session management
- **Templates**: scaffolded into each deployed instance (routes, instrumentation, next.config)

### `packages/runtime` (`@clawrun/runtime`)
Core orchestration logic. The big one:
- **`sandbox/lifecycle.ts`** — `SandboxLifecycleManager`: start, extend, snapshot+stop, wake, force-restart. Evaluates extend reasons (grace period, file activity, cron schedule).
- **`sandbox/extend-reasons.ts`** — pluggable keep-alive logic
- **`sandbox/lock.ts`** — distributed creation lock (prevents duplicate sandboxes)
- **`sandbox/runner.ts`** — `runAgent()` function
- **`sidecar/`** — runs inside the sandbox as a single Node process:
  - `supervisor.ts` — spawns/monitors/restarts the agent daemon, port probing
  - `heartbeat.ts` — POSTs to parent every 60s with mtime + daemon status
  - `health.ts` — HTTP health server on port 3001
  - `mtime.ts` — filesystem change detection
  - `tools.ts` — tool installation inside sandbox
- **`storage/`** — state store abstraction (Redis via ioredis)
- **`config.ts`** + **`schema.ts`** — `clawrun.json` config loading + Zod validation

### `packages/agent` (`@clawrun/agent`)
Defines the abstract `Agent` interface and registry. See AGENTS.md for the full interface.

Registry selects agent by name from `clawrun.json`. Agent implementations live in separate packages (`agent-zeroclaw`).

### `packages/agent-zeroclaw` (`@clawrun/agent-zeroclaw`)
ZeroClaw agent adapter. Implements the `Agent` interface:
- Messaging via daemon WebSocket or CLI one-shot
- Cron job listing
- Provider catalog (OpenRouter, Anthropic, OpenAI, Google, Groq, Mistral, DeepSeek)
- Channel support (Telegram, Discord, Slack, WhatsApp, etc.)
- Config reading/writing (TOML via `@iarna/toml`)
- Tool enablement (AgentBrowserTool)
- Self-registers via `register.ts`

### `packages/provider` (`@clawrun/provider`)
Defines abstract `SandboxProvider` — create, get, list sandboxes; list/delete snapshots. `CountBasedRetention` for snapshot cleanup. Provider implementations live in separate packages (`provider-vercel`).

### `packages/provider-vercel` (`@clawrun/provider-vercel`)
Vercel Sandbox provider. Implements `SandboxProvider`:
- Uses `@vercel/sandbox` SDK
- `VercelManagedSandbox` wrapper (implements `ManagedSandbox`)
- Self-registers via `register.ts`

### `packages/channel` (`@clawrun/channel`)
Defines `WakeHookAdapter` — register/delete webhooks, verify requests, parse wake signals, send courtesy messages. Manager handles hook registration across all configured channels.

9 channel adapters: Telegram, Discord, Slack, WhatsApp, DingTalk, Lark, LinQ, Matrix, QQ.

### `packages/auth` (`@clawrun/auth`)
JWT auth primitives using `jose`:
- Token signing (invite, admin, session tokens)
- Verification and bearer token guards
- Key management

### `packages/ui` (`@clawrun/ui`)
React UI component library:
- Radix UI primitives, shadcn components
- Tailwind CSS styling
- Chat components, session management UI
- Direct src/ exports (not pre-built)

### `packages/zeroclaw` (`zeroclaw`)
TypeScript SDK for ZeroClaw:
- Binary resolution and provisioning into sandbox
- Config generation (TOML) and reading
- Command building for agent, daemon, and cron-list modes
- Output parsing
- Docker-based binary compilation from upstream source

### `packages/logger` (`@clawrun/logger`)
Structured logging using `consola`.

### `packages/tsconfig` (`@clawrun/tsconfig`)
Shared TypeScript configuration. Private, not published.

## Key Architecture

### Plugin System

All extensible concerns use a factory registry pattern:
- **Agents**: `@clawrun/agent` defines the interface, `@clawrun/agent-zeroclaw` implements it and self-registers
- **Providers**: `@clawrun/provider` defines the interface, `@clawrun/provider-vercel` implements it and self-registers
- **Channels**: `@clawrun/channel` defines `WakeHookAdapter`, each adapter directory registers itself

### Sandbox Lifecycle

```
[Message arrives] → webhook handler → wake() if no sandbox running
                                     ↓
                            startNew() → provider.create() from snapshot
                                     ↓
                            provision agent → start sidecar → verify health
                                     ↓
                    [Sidecar runs inside sandbox: supervisor + heartbeat + health]
                                     ↓
                    Heartbeat POSTs to /api/v1/sandbox/heartbeat every 60s
                                     ↓
                    handleExtend() evaluates: grace period / file activity / cron
                                     ↓
                    extend TTL or snapshot+stop → registerWakeHooks()
```

### Sidecar (runs inside sandbox)
Single Node process started as detached. Three responsibilities:
1. **Supervisor** — spawns agent daemon, monitors via TCP port probe, restarts on crash (max 5, reset after 60s stable)
2. **Heartbeat** — POST to parent with `{sandboxId, lastChangedAt, root, daemonStatus, daemonRestarts}`. Parent decides extend/stop.
3. **Health** — HTTP server on port 3001, returns `{ok, daemon, heartbeat, uptime}`

Config passed as JSON file. Secret via `CLAWRUN_HB_SECRET` env var (not in cmdline).

### Config: `clawrun.json`
Central config file written by CLI at deploy time, bundled into the deployed app:
```typescript
{
  instance: { name, preset, provider, deployedUrl, sandboxRoot },
  agent: { name, config, bundlePaths },
  sandbox: { activeDuration, cronKeepAliveWindow, cronWakeLeadTime, resources: { vcpus }, networkPolicy },
  secrets: { cronSecret, jwtSecret, webhookSecrets, sandboxSecret },
  state: { url, token, readOnlyToken?, kvUrl? }
}
```

### Presets
Declarative. A preset = `preset.json` + optional files (personality.md, vercel.json, workspace/). No code.
```json
{
  "id": "starter",
  "name": "Starter",
  "agent": "zeroclaw",
  "provider": "vercel",
  "description": "An AI agent with full provider and channel support"
}
```

## Key Design Decisions

- **Agent runs inside the sandbox, not the serverless function.** The function is the orchestrator. The sandbox is where the agent lives.
- **Persistent sandbox, not per-request.** The daemon runs continuously. Sandbox sleeps (snapshot) when idle, wakes on message or cron.
- **Memory/state lives outside the sandbox.** Sandbox is ephemeral. State store (Redis) persists across sleep/wake cycles.
- **Sidecar pattern.** A single supervisor process inside the sandbox handles daemon lifecycle, heartbeat, and health — the parent only needs one HTTP endpoint to manage the sandbox.
- **Agent interface is pluggable.** ZeroClaw is default, but `Agent` interface exists from day one. Implementations are separate packages that self-register.
- **Provider interface is pluggable.** Vercel Sandbox is default, but the `SandboxProvider` abstraction allows other runtimes.
- **CLI deploys the app.** The CLI is scaffolding/deploy/management tooling, not runtime code.

## Development

```bash
pnpm install
pnpm build          # builds all packages via turbo
pnpm dev            # dev mode
pnpm clawrun        # run CLI from workspace root
```

Node >= 20 required. pnpm workspaces + turbo for monorepo builds.

### Testing locally with Vercel Sandbox
```bash
vercel link
vercel env pull
pnpm dev
# ngrok for webhook: ngrok http 3000
# Set Telegram webhook:
# curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<NGROK>/api/v1/webhook/telegram&secret_token=<SECRET>"
```

## ZeroClaw Quick Reference

```bash
# Single-shot message
zeroclaw agent -m "Hello, ZeroClaw!"

# Daemon mode (what sidecar launches)
zeroclaw serve --port 3000 --host 0.0.0.0

# Non-interactive onboard
zeroclaw onboard --api-key sk-... --provider openrouter --force

# Config: ~/.zeroclaw/config.toml
# Key fields: api_key, default_provider, default_model, default_temperature
# [memory] backend = "sqlite" | "markdown" | "none"
# [autonomy] level = "full", workspace_only = true

# Binary: single static binary, linux-amd64
```

## What NOT to Build

- An AI agent core — ZeroClaw is the agent
- Tool definitions (web search, code exec) — the agent has its own
- An LLM integration layer — the agent calls LLMs itself inside the sandbox
- A skill/plugin system — the agent has its own

## Future Work

- **Conversation history + memory injection** — context builder loads last N messages + extracted memories, injects into agent personality/config
- **Memory extraction** — async cheap LLM call (Haiku) after each exchange to extract facts; keyword retrieval
- **Scheduling + background tasks** — Vercel Cron endpoints, scheduled task table, Inngest for long-running jobs
- **Additional channels** — LinkedIn, Nostr (WakeHookAdapter is already channel-agnostic)
- **Additional agents** — Nanobot adapter to prove pluggability
- **Additional providers** — non-Vercel sandbox runtimes

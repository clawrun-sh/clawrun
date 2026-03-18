# CLAUDE.md — ClawRun

## What This Is

ClawRun is a **hosting and lifecycle layer** for open-source AI agents. It deploys agents into secure sandboxes (Vercel Sandbox, with more providers coming) and manages their full lifecycle, including startup, heartbeat keep-alive, snapshot/resume, graceful shutdown, and wake-on-message.

**ClawRun does NOT build its own agent.** It hosts existing ones. ZeroClaw is the default agent; the `Agent` interface makes it pluggable.

The architecture is a **persistent sandbox** model: the agent daemon runs continuously inside a sandbox, receives messages via its own HTTP server, and ClawRun manages the sandbox TTL, snapshotting, and wake/sleep cycle around it.

## Repo Structure

```
clawrun/
├── CLAUDE.md
├── AGENTS.md
├── packages/
│   ├── cli/              # `clawrun` CLI — deploy, manage, connect to instances
│   ├── server/           # Next.js app: API routes, handlers, UI (deployed per instance)
│   ├── runtime/          # Sandbox lifecycle, sidecar, storage, config
│   ├── agent/            # Agent interface + registry (abstract)
│   ├── agent-zeroclaw/   # ZeroClaw agent adapter (implements Agent)
│   ├── provider/         # SandboxProvider interface (abstract)
│   ├── provider-vercel/  # Vercel Sandbox provider (implements SandboxProvider)
│   ├── channel/          # WakeHookAdapter interface + 6 channel adapters
│   ├── sdk/              # Programmatic API — instance management, deploy, client
│   ├── auth/             # JWT auth primitives (jose)
│   ├── logger/           # Structured logging (consola)
│   ├── ui/               # React UI component library (Radix, shadcn, Tailwind)
│   ├── zeroclaw/         # ZeroClaw TS wrapper (binary mgmt, config gen, command building)
│   ├── website/          # Documentation site (Next.js, not published)
│   └── tsconfig/         # Shared TS config (private, not published)
├── presets/
│   └── starter/          # Default preset: ZeroClaw + Vercel
└── notes/                # Architecture notes and comparisons
```

## Package Responsibilities

### `packages/cli` (`clawrun`)
CLI tool for deploying and managing agent instances. Commands:
- `deploy` — scaffold + deploy a new instance (or redeploy existing)
- `list` — show all instances
- `start` / `stop` — manage sandbox lifecycle
- `agent` — send messages to the agent (interactive TUI or `-m` one-shot)
- `connect` — open a shell inside the sandbox
- `logs` — view/follow instance logs
- `pull` — pull agent state from sandbox to local
- `destroy` — remove an instance
- `invite` — manage invite links
- `web` — open web dashboard

Uses `cmd-ts` for CLI framework, `@clack/prompts` for interactive prompts, `execa` for shelling out.

### `packages/server` (`@clawrun/server`)
Next.js app that gets deployed per instance. This is a **template package**, not a library. Its source files (`app/`, `lib/`, `deploy/`) are copied into each instance's `.deploy/` directory by the SDK. Exports only `./package.json` (read by the SDK to derive deploy dependencies).

Key contents:
- **Handlers**: health, heartbeat, sandbox start/stop/restart, webhook-wake, chat, accept, threads, cron, cost, memory, logs, config, status, diagnostics, events (SSE), workspace files
- **Config**: `createNextConfig()` — generates Next.js config with `outputFileTracingIncludes` for bundling sidecar scripts, agent binaries, and config files
- **Setup**: `setupServer()` — initializes lifecycle hooks and channel adapters
- **UI**: React pages and components for web chat, threads, tools, memory, cron, cost, logs, config, files
- **Deploy**: `instrumentation.ts` — dynamically imports agent and provider register modules at startup

### `packages/runtime` (`@clawrun/runtime`)
Core orchestration logic:
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
Defines the abstract `Agent` interface and factory registry. See AGENTS.md for the full interface (30+ methods covering provisioning, messaging, streaming, threads, dashboard API, config, tools, bundling).

Registry selects agent by name from `clawrun.json`. Agent implementations live in separate packages (`agent-zeroclaw`).

### `packages/agent-zeroclaw` (`@clawrun/agent-zeroclaw`)
ZeroClaw agent adapter. Implements the `Agent` interface:
- Messaging via daemon WebSocket (`/ws/clawrun`) with streaming, or CLI one-shot fallback
- Conversation threads via daemon API
- Provider catalog (46 providers across recommended, fast, gateway, specialized, and local tiers)
- Channel catalog (20 channels)
- Config reading/writing (TOML via `@iarna/toml`)
- Cost tracking via daemon `/api/cost`
- Dashboard API: status, config, tools, cron, memory, cost, diagnostics
- Tool enablement (AgentBrowserTool, GhCliTool, FindSkillsTool)
- Self-registers via `register.ts`

### `packages/provider` (`@clawrun/provider`)
Defines abstract `SandboxProvider` and `ManagedSandbox` interfaces. Includes `CountBasedRetention` for snapshot cleanup. Provider implementations live in separate packages (`provider-vercel`).

### `packages/provider-vercel` (`@clawrun/provider-vercel`)
Vercel Sandbox provider. Implements `SandboxProvider`:
- Uses `@vercel/sandbox` SDK
- `VercelManagedSandbox` wrapper (implements `ManagedSandbox`)
- Self-registers via `register.ts`

### `packages/channel` (`@clawrun/channel`)
Defines `WakeHookAdapter` interface and `ChannelValidator` interface. Manager handles hook registration across all configured channels.

6 wake-hook adapters: Telegram, Discord, Slack, WhatsApp, Lark, QQ. Additional channels (DingTalk, LinQ, Matrix) have validators only.

### `packages/sdk` (`@clawrun/sdk`)
Programmatic API for deploying and managing instances:
- `ClawRunClient` — connects to a deployed instance
- `ClawRunInstance` — lifecycle, chat, threads, memory, cron, cost, logs, workspace
- Instance management — `createInstance()`, `upgradeInstance()`, `destroyInstance()`
- Deploy orchestration — `packLocalDeps()` (dev mode tarballs), `copyServerApp()`, `copyMirroredFiles()`
- Version resolution — `resolvePackageVersion()` reads actual installed versions for production deploys
- Preset registry — load, list, register presets

### `packages/auth` (`@clawrun/auth`)
JWT auth primitives using `jose`:
- Token signing (invite, user, session tokens)
- Verification and bearer token guards
- Cron and sandbox auth guards

### `packages/ui` (`@clawrun/ui`)
React UI component library:
- Radix UI primitives, shadcn components
- Tailwind CSS styling
- Chat components, session management UI, dashboard pages
- Exports raw `src/` TypeScript and CSS (compiled by Next.js at deploy time)

### `packages/zeroclaw` (`zeroclaw`)
TypeScript wrapper for the ZeroClaw AI agent binary:
- Binary resolution and provisioning into sandbox
- Config generation (TOML) and reading
- Command building for agent (`zeroclaw agent -m`) and daemon (`zeroclaw daemon`) modes
- Output parsing
- Schema validation (JSON Schema to Zod)
- Docker-based binary compilation from upstream source with patches and overlay

### `packages/logger` (`@clawrun/logger`)
Structured logging using `consola`.

### `packages/tsconfig` (`@clawrun/tsconfig`)
Shared TypeScript configuration. Private, not published.

## Key Architecture

### Plugin System

All extensible concerns use a factory registry pattern:
- **Agents**: `@clawrun/agent` defines the interface, `@clawrun/agent-zeroclaw` implements it and self-registers
- **Providers**: `@clawrun/provider` defines the interface, `@clawrun/provider-vercel` implements it and self-registers
- **Channels**: `@clawrun/channel` defines `WakeHookAdapter`, each adapter registers itself

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

### Deploy Flow

The CLI scaffolds instances into `~/.clawrun/<instance-name>/`:
```
instance/
├── clawrun.json            # Canonical config (with secrets, never deployed)
├── agent/                  # Agent workspace (source of truth)
│   ├── .secret_key
│   ├── config.toml
│   └── workspace/          # BOOTSTRAP.md, personality, skills
└── .deploy/                # Staging area for deployment
    ├── package.json        # Generated (deploy deps + packed @clawrun/* packages)
    ├── .env                # Secrets as env vars
    ├── clawrun.json        # Sanitized copy (no secrets)
    ├── agent/              # Mirrored from instance root
    ├── app/, lib/, public/ # Copied from @clawrun/server
    ├── instrumentation.ts  # From @clawrun/server/deploy
    └── node_modules/
```

**Dev mode** (`isDevMode()` detects monorepo): `pnpm pack` creates tarballs for each @clawrun/* package, referenced as `file:./` in package.json.

**Production mode** (CLI installed via npm): uses `resolvePackageVersion()` to read actual installed versions from `node_modules`.

### Config: `clawrun.json`
Central config file written by CLI at deploy time:
```typescript
{
  instance: { name, preset, provider, deployedUrl?, sandboxRoot, platformUrlEnvVars },
  agent: { name, config, bundlePaths, configPaths, tools },
  sandbox: { activeDuration, cronKeepAliveWindow, cronWakeLeadTime, resources: { vcpus, memory? }, networkPolicy },
  serverExternalPackages: string[],
  secrets: { cronSecret, jwtSecret, webhookSecrets, sandboxSecret },
  state?: { redisUrl }
}
```

Secrets are stripped by `sanitizeConfig()` before bundling into `.deploy/`. Only `instance`, `agent`, `sandbox`, and `serverExternalPackages` are deployed. Secrets reach the runtime as env vars.

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
- **Sidecar pattern.** A single supervisor process inside the sandbox handles daemon lifecycle, heartbeat, and health. The parent only needs one HTTP endpoint to manage the sandbox.
- **Agent interface is pluggable.** ZeroClaw is default, but the `Agent` interface exists from day one. Implementations are separate packages that self-register.
- **Provider interface is pluggable.** Vercel Sandbox is default, but the `SandboxProvider` abstraction allows other runtimes.
- **CLI deploys the app.** The CLI is scaffolding/deploy/management tooling, not runtime code.
- **Server is a template, not a library.** Source files are copied into each instance, not imported. This allows per-instance customization.

## Development

```bash
pnpm install
pnpm build          # builds all packages via turbo
pnpm dev            # dev mode
pnpm clawrun        # run CLI from workspace root
pnpm test           # run all tests
pnpm changeset      # create a changeset for version management
```

Node >= 20 required. pnpm workspaces + turbo for monorepo builds. Changesets for version management and publishing.

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
zeroclaw daemon --port 3000 --host 0.0.0.0

# Config: ~/.zeroclaw/config.toml
# Key fields: api_key, default_provider, default_model, default_temperature
# [memory] backend = "sqlite" | "markdown" | "none"
# [autonomy] level = "full", workspace_only = true
# [cost] enabled = true, daily_limit_usd = 10.0, monthly_limit_usd = 100.0

# Binary: single static binary, linux-amd64
# Build: packages/zeroclaw/build-docker.sh (Docker + Rust musl)
# Patches: packages/zeroclaw/upstream/patches/ (applied in order)
# Overlay: packages/zeroclaw/upstream/overlay/ (new files copied on top)
```

## What NOT to Build

- An AI agent core. ZeroClaw is the agent.
- Tool definitions (web search, code exec). The agent has its own.
- An LLM integration layer. The agent calls LLMs itself inside the sandbox.
- A skill/plugin system. The agent has its own.

# ClawRun

Deploy and manage AI agents in seconds.

ClawRun is a hosting and orchestration layer for open-source AI agents. It deploys a Next.js app to Vercel that runs agents inside Firecracker microVMs per-request.

**Website:** [clawrun.sh](https://clawrun.sh)
**Docs:** [clawrun.sh/docs](https://clawrun.sh/docs)

## Install

```bash
npx clawrun
```

## Quick Start

Deploy a ZeroClaw agent:

```bash
npx clawrun deploy zeroclaw-basic
```

This will:

1. Prompt for your LLM API key and Telegram bot token
2. Scaffold a Next.js app configured for your agent
3. Deploy it to Vercel

## Commands

```bash
# Deploy an agent preset
clawrun deploy <preset>

# Pull the latest server package into an existing instance
clawrun pull <instance>

# Start the dev server for a local instance
clawrun start <instance>
```

## Available Presets

- `zeroclaw-basic` — ZeroClaw AI agent with Telegram integration

## Requirements

- Node.js >= 20
- Vercel CLI (`npm i -g vercel`)
- A Vercel account

## License

Apache-2.0

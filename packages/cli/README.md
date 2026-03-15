<div align="center">
  <a href="https://clawrun.sh" target="_blank">
    <img alt="ClawRun" src="https://clawrun.sh/favicon.svg" height="110">
  </a>
  <h1>Deploy and manage AI agents in seconds</h1>
  <p>
    <a href="https://www.npmjs.com/package/clawrun" target="_blank">
      <img src="https://img.shields.io/npm/v/clawrun?style=for-the-badge&labelColor=000000" alt="npm version" />
    </a>
    <a href="https://www.npmjs.com/package/clawrun" target="_blank">
      <img src="https://img.shields.io/npm/l/clawrun?style=for-the-badge&labelColor=000000" alt="license" />
    </a>
    <a href="https://github.com/clawrun-sh/clawrun/discussions" target="_blank">
      <img src="https://img.shields.io/badge/Join%20the%20community-blueviolet?style=for-the-badge&logo=Github&labelColor=000000&logoWidth=20" alt="join the community" />
    </a>
  </p>
</div>

## Overview

<a href="https://clawrun.sh" target="_blank">
  <img alt="ClawRun" src="https://clawrun.sh/og.png">
</a>

ClawRun is a hosting and lifecycle layer for open-source AI agents. It deploys agents into Firecracker microVMs (e.g. Vercel Sandbox) and manages their full lifecycle, including startup, heartbeat keep-alive, snapshot/resume, and wake-on-message.

Learn more at [clawrun.sh](https://clawrun.sh).

## Features

- 🚀 Deploy any supported AI agent with a single command
- 💤 Persistent sandboxes that sleep when idle and wake on message
- 💬 Connect messaging channels like Telegram, Discord, Slack, WhatsApp, and more
- 🖥️ Web dashboard and CLI for real-time chat and management
- 💰 Cost tracking and budget enforcement across all channels
- 🔌 Pluggable architecture for agents, providers, and channels

## Getting Started

```bash
npx clawrun deploy
```

The deploy wizard walks you through:

1. Choosing an LLM provider and model
2. Configuring messaging channels
3. Setting cost limits and network policy
4. Deploying to Vercel

Once deployed, chat with your agent from the terminal:

```bash
clawrun agent my-instance
```

Or open the web dashboard:

```bash
clawrun web my-instance
```

For full setup guides, framework examples, and configuration reference, see the [docs](https://clawrun.sh/docs).

## Contributing

Report issues and suggest improvements on GitHub: [Issues](https://github.com/clawrun-sh/clawrun/issues).

Join the community: [Discussions](https://github.com/clawrun-sh/clawrun/discussions).

## License

Apache-2.0

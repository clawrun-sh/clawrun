# Contributing to ClawRun

Thanks for your interest in contributing to ClawRun! This guide will help you get set up and understand how we work.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) 9.x (`corepack enable` will set it up)
- [Docker](https://www.docker.com/) (only needed if rebuilding the ZeroClaw binary)

## Getting Started

```bash
# Clone the repo
git clone https://github.com/clawrun-sh/clawrun.git
cd clawrun

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

## Repo Structure

ClawRun is a pnpm monorepo managed with [Turborepo](https://turbo.build/repo). Key packages:

| Package | Description |
|---|---|
| `packages/cli` | `clawrun` CLI |
| `packages/server` | Next.js server (deployed per instance) |
| `packages/runtime` | Sandbox lifecycle, sidecar, state store |
| `packages/agent` | Abstract Agent interface and registry |
| `packages/agent-zeroclaw` | ZeroClaw agent adapter |
| `packages/provider` | Abstract SandboxProvider interface |
| `packages/provider-vercel` | Vercel Sandbox provider |
| `packages/channel` | Wake hook adapters (Telegram, Discord, Slack, etc.) |
| `packages/sdk` | Programmatic API for deploying and managing instances |
| `packages/ui` | React UI component library |
| `packages/auth` | JWT auth primitives |
| `packages/logger` | Structured logging |
| `packages/zeroclaw` | ZeroClaw binary wrapper and config generator |

## Development Workflow

```bash
# Run in dev mode
pnpm dev

# Build a specific package
pnpm --filter @clawrun/runtime build

# Run tests for a specific package
pnpm --filter @clawrun/agent-zeroclaw test

# Lint and format
pnpm lint
pnpm format
```

## Making Changes

1. Create a branch from `main`
2. Make your changes
3. Add a changeset describing what changed:
   ```bash
   pnpm changeset
   ```
   Select the affected packages, choose the bump type (patch/minor/major), and write a summary.
4. Run `pnpm build && pnpm test` to verify
5. Open a pull request

## Pull Request Guidelines

- Keep PRs focused on a single change
- Include tests for new functionality
- Run `pnpm lint` and `pnpm format:check` before submitting
- Add a changeset if your change affects published packages
- Link related issues in the PR description

## Reporting Bugs

Use [GitHub Issues](https://github.com/clawrun-sh/clawrun/issues) with the bug report template. Include steps to reproduce, expected behavior, and your environment details.

## Asking Questions

For questions and discussions, use [GitHub Discussions](https://github.com/clawrun-sh/clawrun/discussions) or join our [Discord](https://discord.gg/Bm5P5Md2MY).

## License

By contributing to ClawRun, you agree that your contributions will be licensed under the [Apache-2.0 License](LICENSE).

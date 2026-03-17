# zeroclaw

TypeScript/JavaScript bindings for the [ZeroClaw](https://github.com/zeroclaw-labs/zeroclaw) AI agent. Provides binary resolution, config generation, command building, and sandbox provisioning.

## Install

```bash
npm install zeroclaw
# or
pnpm add zeroclaw
```

The package includes a pre-built `linux-x64` binary for sandbox deployment.

## Usage

### Build a one-shot agent command

Send a single message and get a response:

```typescript
import { getBinaryPath, buildAgentCommand, parseOutput } from "zeroclaw";

const binary = getBinaryPath("linux-x64");
const { cmd, args, env } = buildAgentCommand(binary, "What is 2 + 2?", {
  ZEROCLAW_CONFIG_DIR: "/path/to/agent",
});

// Execute with your preferred runner (execa, child_process, sandbox, etc.)
const result = await exec(cmd, args, { env });
const output = parseOutput(result.stdout, result.stderr, result.exitCode);

console.log(output.message); // "4"
```

### Start the agent daemon

Run ZeroClaw as a persistent HTTP/WebSocket server:

```typescript
import { buildDaemonCommand } from "zeroclaw";

const binary = getBinaryPath("linux-x64");
const { cmd, args, env } = buildDaemonCommand(binary, {
  ZEROCLAW_CONFIG_DIR: "/path/to/agent",
}, { port: 3000, host: "0.0.0.0" });

// Start as a long-running process
spawn(cmd, args, { env, detached: true });
// Daemon listens on http://0.0.0.0:3000
// WebSocket: ws://0.0.0.0:3000/ws/chat
```

### Read and generate config

Read an existing `config.toml` and generate a daemon-ready version:

```typescript
import { readParsedConfig, generateDaemonToml } from "zeroclaw";

// Read the agent's config.toml
const config = readParsedConfig("/path/to/agent");
console.log(config.default_provider); // "openrouter"
console.log(config.default_model);    // "anthropic/claude-sonnet-4"

// Generate a TOML string with daemon-mode overrides
// (sets gateway port/host, enables browser backend, etc.)
const toml = generateDaemonToml(config);
```

### Validate config against the schema

```typescript
import { validateConfig, safeValidateConfig, schemaDefaults } from "zeroclaw";

// Throws on invalid config
const config = validateConfig({ default_temperature: 0.7 });

// Returns { success, data } or { success, error } without throwing
const result = safeValidateConfig(userInput);
if (result.success) {
  console.log(result.data.default_temperature);
}

// Get schema defaults for all top-level fields
console.log(schemaDefaults);
```

### Provision into a sandbox

Deploy the ZeroClaw binary and config into a remote sandbox environment:

```typescript
import { provision } from "zeroclaw";

await provision(sandbox, {
  binPath: "/usr/local/bin/zeroclaw",
  agentDir: "/home/agent/.zeroclaw",
  localAgentDir: "./agent",
  secretKey: "base64-encoded-secret",
  fromSnapshot: false, // true to skip workspace .md files on restore
});
```

The `sandbox` parameter implements the `ZeroclawSandbox` interface:

```typescript
interface ZeroclawSandbox {
  runCommand(cmd: string, args?: string[]): Promise<CommandResult>;
  writeFiles(files: Array<{ path: string; content: Buffer }>): Promise<void>;
  readFile(path: string): Promise<Buffer | null>;
}
```

## API Reference

| Export | Description |
|---|---|
| `getBinaryPath(platform?)` | Resolve the path to the ZeroClaw binary for a given platform |
| `buildAgentCommand(binary, message, env)` | Build a one-shot agent command (`zeroclaw agent -m`) |
| `buildDaemonCommand(binary, env, opts?)` | Build a daemon command (`zeroclaw daemon --port --host`) |
| `parseOutput(stdout, stderr, exitCode)` | Parse command output into `{ success, message, error? }` |
| `readParsedConfig(agentDir)` | Read and parse `config.toml` from an agent directory |
| `generateDaemonToml(config)` | Generate a daemon-ready TOML config string |
| `validateConfig(config)` | Validate config against the ZeroClaw JSON Schema (throws on error) |
| `safeValidateConfig(config)` | Validate without throwing (returns success/error result) |
| `schemaDefaults` | Default values for all top-level schema properties |
| `provision(sandbox, opts)` | Deploy binary, config, and workspace files into a sandbox |
| `DAEMON_PORT` | Default daemon port (3000) |
| `DAEMON_PROCESS_PATTERN` | Process name pattern for daemon detection |
| `HOUSEKEEPING_FILES` | Files excluded from workspace monitoring |

## Types

```typescript
import type { ZeroclawSandbox, CommandResult, ZeroClawConfig, ProvisionOptions } from "zeroclaw";
```

## Part of ClawRun

This package is used by [ClawRun](https://clawrun.sh) to manage ZeroClaw agents in secure sandboxes. It can also be used independently to integrate ZeroClaw into your own infrastructure.

## License

Apache-2.0

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { execa } from "execa";
import { instanceDir, instancesDir, instanceAgentDir, instanceDeployDir } from "./paths.js";
import { applyTemplates } from "./templates.js";
import type { ClawRunConfig } from "./config.js";
import { readConfig, writeConfig } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface InstanceMetadata {
  name: string;
  preset: string;
  agent: string;
  appVersion: string;
  deployedUrl?: string;
}

interface InstancePackageJson {
  name: string;
  private: boolean;
  dependencies: Record<string, string>;
}

export function isDevMode(): boolean {
  // In dev mode, CLI runs from packages/cli/dist/ inside the monorepo.
  // Check for packages/server relative to the repo root.
  const repoRoot = resolve(__dirname, "..", "..", "..", "..");
  return existsSync(join(repoRoot, "packages", "server", "package.json"));
}

function getMonorepoRoot(): string {
  return resolve(__dirname, "..", "..", "..", "..");
}

async function packLocalDeps(instancePath: string): Promise<Record<string, string>> {
  const root = getMonorepoRoot();
  const deps: Record<string, string> = {};

  // pnpm pack must be run from the workspace root so it can resolve workspace:* deps
  // Pack in dependency order: zeroclaw and provider first since @clawrun/server depends on both
  const packages = [
    { name: "zeroclaw", dir: join(root, "packages", "zeroclaw") },
    { name: "@clawrun/agent", dir: join(root, "packages", "agent") },
    { name: "@clawrun/provider", dir: join(root, "packages", "provider") },
    { name: "@clawrun/channel", dir: join(root, "packages", "channel") },
    { name: "@clawrun/runtime", dir: join(root, "packages", "runtime") },
    { name: "@clawrun/logger", dir: join(root, "packages", "logger") },
    { name: "@clawrun/server", dir: join(root, "packages", "server") },
  ];

  for (const pkg of packages) {
    console.log(chalk.dim(`  Packing ${pkg.name}...`));
    const { stdout } = await execa("pnpm", ["pack", "--pack-destination", instancePath], {
      cwd: pkg.dir,
    });
    // pnpm pack prints the tarball path — grab the filename only
    const tarballPath = stdout.trim().split("\n").pop()?.trim() ?? "";
    const tarball = tarballPath.split("/").pop() ?? tarballPath;
    deps[pkg.name] = `file:./${tarball}`;
  }

  return deps;
}

// Direct dependencies every instance needs for `next build` to succeed.
// These are transitive deps of @clawrun/server but must be available
// as top-level deps for Vercel's build step.
const INSTANCE_PEER_DEPS: Record<string, string> = {
  next: "^16.0.0",
  react: "^19.0.0",
  "react-dom": "^19.0.0",
  typescript: "^5.7.0",
  "@types/node": "^22.0.0",
  "@types/react": "^19.0.0",
  "@types/react-dom": "^19.0.0",
};

function buildPackageJson(name: string, deps: Record<string, string>): InstancePackageJson {
  return {
    name,
    private: true,
    dependencies: {
      ...INSTANCE_PEER_DEPS,
      ...deps,
    },
  };
}

function writeEnvFile(dir: string, envVars: Record<string, string>): void {
  const content = Object.entries(envVars)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  writeFileSync(join(dir, ".env"), content + "\n");
}

export async function createInstance(
  name: string,
  config: ClawRunConfig,
  envVars: Record<string, string>,
): Promise<string> {
  const dir = instanceDir(name);
  const agentDir = instanceAgentDir(name);
  const deployDir = instanceDeployDir(name);
  const devMode = isDevMode();

  // Tolerate pre-existing dir (wizard may have already created agent/ subdir)
  if (existsSync(join(dir, "clawrun.json"))) {
    throw new Error(`Instance "${name}" already exists at ${dir}`);
  }

  console.log(chalk.cyan(`\nCreating instance "${name}"...`));
  console.log(chalk.dim(`  Path: ${dir}`));
  console.log(chalk.dim(`  Mode: ${devMode ? "dev (packed tarballs)" : "production"}`));

  // Create directories
  mkdirSync(dir, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(deployDir, { recursive: true });

  // Write clawrun.json at instance root (canonical config)
  writeConfig(name, config);

  // Generate .secret_key at agent/ dir (source of truth for agent identity)
  if (!existsSync(join(agentDir, ".secret_key"))) {
    const { randomBytes } = await import("node:crypto");
    writeFileSync(join(agentDir, ".secret_key"), randomBytes(32).toString("base64"));
  }

  // Resolve dependencies
  let deps: Record<string, string>;
  if (devMode) {
    console.log(chalk.cyan("\n  Packing local packages...\n"));
    deps = await packLocalDeps(deployDir);
  } else {
    deps = {
      "@clawrun/agent": "0.1.0",
      "@clawrun/provider": "0.1.0",
      "@clawrun/channel": "0.1.0",
      "@clawrun/logger": "0.1.0",
      "@clawrun/runtime": "0.1.0",
      "@clawrun/server": "0.1.0",
      zeroclaw: "0.1.0",
    };
  }

  // Write package.json into .deploy/
  const pkg = buildPackageJson(name, deps);
  writeFileSync(join(deployDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

  // Write .env into .deploy/ (derived from config + agent config, for Next.js runtime)
  writeEnvFile(deployDir, envVars);

  // Copy mirrored files into .deploy/ for Vercel bundling
  copyMirroredFiles(name);

  // Install dependencies in .deploy/
  console.log(chalk.cyan("\n  Installing dependencies...\n"));
  await execa("npm", ["install"], {
    cwd: deployDir,
    stdio: "inherit",
  });

  // Apply templates from installed @clawrun/server into .deploy/
  console.log(chalk.cyan("\n  Applying templates..."));
  applyTemplates(deployDir);

  console.log(chalk.green(`\n  Instance "${name}" created.`));
  return dir;
}

/**
 * Copy files that are mirrored between local instance root and .deploy/.
 * These files live at the instance root (source of truth) and are copied
 * into .deploy/ so Vercel can bundle them.
 */
export function copyMirroredFiles(name: string): void {
  const dir = instanceDir(name);
  const agentDir = instanceAgentDir(name);
  const deployDir = instanceDeployDir(name);

  // clawrun.json
  const configSrc = join(dir, "clawrun.json");
  if (existsSync(configSrc)) {
    writeFileSync(join(deployDir, "clawrun.json"), readFileSync(configSrc));
  }

  // agent/config.toml
  const agentDeployDir = join(deployDir, "agent");
  mkdirSync(agentDeployDir, { recursive: true });

  const configTomlSrc = join(agentDir, "config.toml");
  if (existsSync(configTomlSrc)) {
    writeFileSync(join(agentDeployDir, "config.toml"), readFileSync(configTomlSrc));
  }

  // agent/.secret_key
  const secretKeySrc = join(agentDir, ".secret_key");
  if (existsSync(secretKeySrc)) {
    writeFileSync(join(agentDeployDir, ".secret_key"), readFileSync(secretKeySrc));
  }

  // agent/workspace/*.md — workspace template files
  const workspaceSrc = join(agentDir, "workspace");
  if (existsSync(workspaceSrc)) {
    const workspaceDeployDir = join(agentDeployDir, "workspace");
    mkdirSync(workspaceDeployDir, { recursive: true });
    for (const f of readdirSync(workspaceSrc)) {
      if (f.endsWith(".md")) {
        writeFileSync(join(workspaceDeployDir, f), readFileSync(join(workspaceSrc, f)));
      }
    }
  }
}

export function listInstances(): InstanceMetadata[] {
  const dir = instancesDir();
  if (!existsSync(dir)) {
    return [];
  }

  const entries = readdirSync(dir, { withFileTypes: true });
  const instances: InstanceMetadata[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    // Check for clawrun.json at instance root (not package.json)
    const cfgPath = join(dir, entry.name, "clawrun.json");
    if (!existsSync(cfgPath)) continue;

    const config = readConfig(entry.name);
    if (!config) continue;

    // Read app version from .deploy/package.json if it exists
    const deployPkgPath = join(dir, entry.name, ".deploy", "package.json");
    let appVersion = "unknown";
    if (existsSync(deployPkgPath)) {
      const pkg = JSON.parse(readFileSync(deployPkgPath, "utf-8")) as InstancePackageJson;
      appVersion = pkg.dependencies?.["@clawrun/server"] ?? "unknown";
    }

    instances.push({
      name: entry.name,
      preset: config.instance.preset ?? "unknown",
      agent: config.agent.name,
      appVersion,
      deployedUrl: config.instance.deployedUrl,
    });
  }

  return instances;
}

export function getInstance(name: string): InstanceMetadata | null {
  const dir = instanceDir(name);

  const config = readConfig(name);
  if (!config) return null;

  // Read app version from .deploy/package.json if it exists
  const deployPkgPath = join(dir, ".deploy", "package.json");
  let appVersion = "unknown";
  if (existsSync(deployPkgPath)) {
    const pkg = JSON.parse(readFileSync(deployPkgPath, "utf-8")) as InstancePackageJson;
    appVersion = pkg.dependencies?.["@clawrun/server"] ?? "unknown";
  }

  return {
    name,
    preset: config.instance.preset ?? "unknown",
    agent: config.agent.name,
    appVersion,
    deployedUrl: config.instance.deployedUrl,
  };
}

export function instanceExists(name: string): boolean {
  return existsSync(join(instanceDir(name), "clawrun.json"));
}

export function saveDeployedUrl(name: string, url: string): void {
  const config = readConfig(name);
  if (!config) {
    throw new Error(`No clawrun.json found for instance "${name}"`);
  }
  config.instance.deployedUrl = url;
  writeConfig(name, config);
}

export async function upgradeInstance(name: string): Promise<void> {
  const dir = instanceDir(name);
  const deployDir = instanceDeployDir(name);

  if (!existsSync(dir)) {
    throw new Error(`Instance "${name}" does not exist.`);
  }

  // Ensure .deploy/ exists (migration from old layout)
  mkdirSync(deployDir, { recursive: true });

  console.log(chalk.cyan(`\nUpgrading instance "${name}"...`));

  // In dev mode, repack local packages to pick up changes
  if (isDevMode()) {
    console.log(chalk.cyan("  Repacking local packages...\n"));
    const deps = await packLocalDeps(deployDir);

    // Update package.json with new tarball paths and current peer deps
    const pkgPath = join(deployDir, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as InstancePackageJson;
      Object.assign(pkg.dependencies, INSTANCE_PEER_DEPS, deps);
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    }
  }

  // Remove node_modules to force fresh install from new tarballs
  const nodeModulesDir = join(deployDir, "node_modules");
  if (existsSync(nodeModulesDir)) {
    console.log(chalk.dim("  Cleaning node_modules..."));
    rmSync(nodeModulesDir, { recursive: true, force: true });
  }

  // Remove stale lock file so npm resolves from new tarballs
  const lockPath = join(deployDir, "package-lock.json");
  if (existsSync(lockPath)) {
    rmSync(lockPath);
  }

  // Remove .next build cache so Vercel does a clean build
  const nextCacheDir = join(deployDir, ".next");
  if (existsSync(nextCacheDir)) {
    console.log(chalk.dim("  Cleaning .next cache..."));
    rmSync(nextCacheDir, { recursive: true, force: true });
  }

  // Copy mirrored files from instance root into .deploy/
  copyMirroredFiles(name);

  // Fresh install
  console.log(chalk.cyan("  Installing dependencies...\n"));
  await execa("npm", ["install"], {
    cwd: deployDir,
    stdio: "inherit",
  });

  // Reapply templates from the updated @clawrun/server
  console.log(chalk.cyan("\n  Reapplying templates..."));
  applyTemplates(deployDir);

  console.log(chalk.green(`  Instance "${name}" upgraded.`));
}

export function destroyInstance(name: string): void {
  const dir = instanceDir(name);

  if (!existsSync(dir)) {
    throw new Error(`Instance "${name}" does not exist.`);
  }

  rmSync(dir, { recursive: true, force: true });
  console.log(chalk.green(`  Instance "${name}" destroyed.`));
}

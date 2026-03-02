import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { execa } from "execa";
import { createAgent } from "@clawrun/agent";
import { instanceDir, instancesDir, instanceAgentDir, instanceDeployDir } from "./paths.js";
import { copyServerApp } from "./templates.js";
import type { ClawRunConfig } from "./config.js";
import { readConfig, writeConfig, sanitizeConfig } from "./config.js";

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
  version?: string;
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

async function packLocalDeps(
  instancePath: string,
  config: ClawRunConfig,
): Promise<Record<string, string>> {
  const root = getMonorepoRoot();
  const deps: Record<string, string> = {};

  // Core packages (always needed)
  const packages = [
    { name: "@clawrun/agent", dir: join(root, "packages", "agent") },
    { name: "@clawrun/auth", dir: join(root, "packages", "auth") },
    { name: "@clawrun/provider", dir: join(root, "packages", "provider") },
    { name: "@clawrun/channel", dir: join(root, "packages", "channel") },
    { name: "@clawrun/runtime", dir: join(root, "packages", "runtime") },
    { name: "@clawrun/logger", dir: join(root, "packages", "logger") },
    { name: "@clawrun/ui", dir: join(root, "packages", "ui") },
  ];

  // Agent-specific packages
  const agentName = config.agent.name;
  const agentPkgDir = join(root, "packages", `agent-${agentName}`);
  if (existsSync(agentPkgDir)) {
    packages.push({ name: `@clawrun/agent-${agentName}`, dir: agentPkgDir });
  }
  // Agent's own SDK deps (e.g., "zeroclaw" SDK package)
  const agent = createAgent(agentName);
  for (const depName of Object.keys(agent.getInstallDependencies())) {
    const depDir = join(root, "packages", depName);
    if (existsSync(depDir)) {
      packages.push({ name: depName, dir: depDir });
    }
  }

  // Provider-specific packages
  const providerName = config.instance.provider;
  const providerPkgDir = join(root, "packages", `provider-${providerName}`);
  if (existsSync(providerPkgDir)) {
    packages.push({ name: `@clawrun/provider-${providerName}`, dir: providerPkgDir });
  }

  for (const pkg of packages) {
    clack.log.info(chalk.dim(`Packing ${pkg.name}...`));
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
  ai: "^6.0.0",
  "@ai-sdk/react": "^3.0.0",
  "lucide-react": "^0.500.0",
  dexie: "^4.0.0",
  "next-themes": "^0.4.0",
  shadcn: "^3.8.5",
  streamdown: "^2.3.0",
  tailwindcss: "^4.0.0",
  "tw-animate-css": "^1.4.0",
  "@tailwindcss/postcss": "^4.0.0",
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
  opts?: { presetDeps?: Record<string, string> },
): Promise<string> {
  const dir = instanceDir(name);
  const agentDir = instanceAgentDir(name);
  const deployDir = instanceDeployDir(name);
  const devMode = isDevMode();

  // Tolerate pre-existing dir (wizard may have already created agent/ subdir)
  if (existsSync(join(dir, "clawrun.json"))) {
    throw new Error(`Instance "${name}" already exists at ${dir}`);
  }

  clack.log.step(
    `Creating instance "${name}"\n` +
      chalk.dim(`Path: ${dir}\n`) +
      chalk.dim(`Mode: ${devMode ? "dev (packed tarballs)" : "production"}`),
  );

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
    clack.log.step("Packing local packages...");
    deps = await packLocalDeps(deployDir, config);
  } else {
    deps = {
      "@clawrun/agent": "0.1.0",
      [`@clawrun/agent-${config.agent.name}`]: "0.1.0",
      "@clawrun/auth": "0.1.0",
      "@clawrun/provider": "0.1.0",
      [`@clawrun/provider-${config.instance.provider}`]: "0.1.0",
      "@clawrun/channel": "0.1.0",
      "@clawrun/logger": "0.1.0",
      "@clawrun/runtime": "0.1.0",
      "@clawrun/ui": "0.1.0",
      ...(opts?.presetDeps ?? {}),
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
  clack.log.step("Installing dependencies...");
  await execa("npm", ["install"], {
    cwd: deployDir,
    stdio: "inherit",
  });

  // Copy server app source into .deploy/
  clack.log.step("Copying server app...");
  copyServerApp(deployDir);

  clack.log.success(`Instance "${name}" created.`);
  return dir;
}

/**
 * Resolve simple glob patterns (e.g. "workspace/*.md") against a base directory.
 * Supports bare filenames and single-level wildcards like "dir/*.ext".
 */
function resolveGlobPattern(baseDir: string, pattern: string): string[] {
  const files: string[] = [];

  if (!pattern.includes("*")) {
    // Plain file
    const fullPath = join(baseDir, pattern);
    if (existsSync(fullPath)) files.push(pattern);
    return files;
  }

  // Simple single-level wildcard: "dir/*.ext"
  const lastSlash = pattern.lastIndexOf("/");
  const dir = lastSlash >= 0 ? pattern.slice(0, lastSlash) : ".";
  const filePattern = lastSlash >= 0 ? pattern.slice(lastSlash + 1) : pattern;

  const searchDir = dir === "." ? baseDir : join(baseDir, dir);
  if (!existsSync(searchDir)) return files;

  // Convert wildcard to regex
  const re = new RegExp("^" + filePattern.replace(/\./g, "\\.").replace(/\*/g, "[^/]*") + "$");

  for (const f of readdirSync(searchDir)) {
    if (re.test(f)) {
      files.push(dir === "." ? f : `${dir}/${f}`);
    }
  }

  return files;
}

/**
 * Copy files that are mirrored between local instance root and .deploy/.
 * These files live at the instance root (source of truth) and are copied
 * into .deploy/ so Vercel can bundle them.
 */
export function copyMirroredFiles(name: string): void {
  const agentDir = instanceAgentDir(name);
  const deployDir = instanceDeployDir(name);

  // clawrun.json — sanitize before bundling (secrets stay as env vars only)
  const config = readConfig(name);
  if (config) {
    const safe = sanitizeConfig(config);
    writeFileSync(join(deployDir, "clawrun.json"), JSON.stringify(safe, null, 2) + "\n");
  }

  // Copy agent files declared by the agent's getBundleFiles()
  if (!config) {
    throw new Error(`No clawrun.json found for instance "${name}"`);
  }
  const agent = createAgent(config.agent.name);
  const bundlePatterns = agent.getBundleFiles();
  const agentDeployDir = join(deployDir, "agent");
  mkdirSync(agentDeployDir, { recursive: true });

  for (const pattern of bundlePatterns) {
    const resolved = resolveGlobPattern(agentDir, pattern);
    for (const relPath of resolved) {
      const src = join(agentDir, relPath);
      const dest = join(agentDeployDir, relPath);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(src));
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

    // Read app version from .deploy/package.json
    const deployPkgPath = join(dir, entry.name, ".deploy", "package.json");
    let appVersion = "unknown";
    if (existsSync(deployPkgPath)) {
      const pkg = JSON.parse(readFileSync(deployPkgPath, "utf-8")) as InstancePackageJson;
      appVersion = pkg.version ?? "unknown";
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

  // Read app version from .deploy/package.json
  const deployPkgPath = join(dir, ".deploy", "package.json");
  let appVersion = "unknown";
  if (existsSync(deployPkgPath)) {
    const pkg = JSON.parse(readFileSync(deployPkgPath, "utf-8")) as InstancePackageJson;
    appVersion = pkg.version ?? "unknown";
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

  clack.log.step(`Upgrading instance "${name}"...`);

  // In dev mode, repack local packages to pick up changes
  if (isDevMode()) {
    const config = readConfig(name);
    if (!config) {
      throw new Error(`No clawrun.json found for instance "${name}"`);
    }
    clack.log.step("Repacking local packages...");
    const deps = await packLocalDeps(deployDir, config);

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
    clack.log.info(chalk.dim("Cleaning node_modules..."));
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
    clack.log.info(chalk.dim("Cleaning .next cache..."));
    rmSync(nextCacheDir, { recursive: true, force: true });
  }

  // Copy mirrored files from instance root into .deploy/
  copyMirroredFiles(name);

  // Fresh install
  clack.log.step("Installing dependencies...");
  await execa("npm", ["install"], {
    cwd: deployDir,
    stdio: "inherit",
  });

  // Copy updated server app source
  clack.log.step("Copying server app...");
  copyServerApp(deployDir);

  clack.log.success(`Instance "${name}" upgraded.`);
}

export function destroyInstance(name: string): void {
  const dir = instanceDir(name);

  if (!existsSync(dir)) {
    throw new Error(`Instance "${name}" does not exist.`);
  }

  rmSync(dir, { recursive: true, force: true });
  clack.log.success(`Instance "${name}" destroyed.`);
}

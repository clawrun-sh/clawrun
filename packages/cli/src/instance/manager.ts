import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { execa } from "execa";
import { instanceDir, instancesDir } from "./paths.js";
import { applyTemplates } from "./templates.js";
import type { CloudClawConfig } from "./config.js";
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
  // Check for packages/app relative to the repo root.
  const repoRoot = resolve(__dirname, "..", "..", "..", "..");
  return existsSync(join(repoRoot, "packages", "app", "package.json"));
}

function getMonorepoRoot(): string {
  return resolve(__dirname, "..", "..", "..", "..");
}

async function packLocalDeps(instancePath: string): Promise<Record<string, string>> {
  const root = getMonorepoRoot();
  const deps: Record<string, string> = {};

  // pnpm pack must be run from the workspace root so it can resolve workspace:* deps
  // Pack in dependency order: zeroclaw and provider first since @cloudclaw/app depends on both
  const packages = [
    { name: "zeroclaw", dir: join(root, "packages", "zeroclaw") },
    { name: "@cloudclaw/provider", dir: join(root, "packages", "provider") },
    { name: "@cloudclaw/app", dir: join(root, "packages", "app") },
  ];

  for (const pkg of packages) {
    console.log(chalk.dim(`  Packing ${pkg.name}...`));
    const { stdout } = await execa(
      "pnpm",
      ["pack", "--pack-destination", instancePath],
      { cwd: pkg.dir },
    );
    // pnpm pack prints the tarball path — grab the filename only
    const tarballPath = stdout.trim().split("\n").pop()?.trim() ?? "";
    const tarball = tarballPath.split("/").pop() ?? tarballPath;
    deps[pkg.name] = `file:./${tarball}`;
  }

  return deps;
}

// Direct dependencies every instance needs for `next build` to succeed.
// These are transitive deps of @cloudclaw/app but must be available
// as top-level deps for Vercel's build step.
const INSTANCE_PEER_DEPS: Record<string, string> = {
  "next": "^15.1.0",
  "react": "^19.0.0",
  "react-dom": "^19.0.0",
  "typescript": "^5.7.0",
  "@types/node": "^22.0.0",
  "@types/react": "^19.0.0",
  "@types/react-dom": "^19.0.0",
};

function buildPackageJson(
  name: string,
  deps: Record<string, string>,
): InstancePackageJson {
  return {
    name,
    private: true,
    dependencies: {
      ...INSTANCE_PEER_DEPS,
      ...deps,
    },
  };
}

function writeEnvFile(
  dir: string,
  envVars: Record<string, string>,
): void {
  const content = Object.entries(envVars)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  writeFileSync(join(dir, ".env"), content + "\n");
}

export async function createInstance(
  name: string,
  config: CloudClawConfig,
  envVars: Record<string, string>,
): Promise<string> {
  const dir = instanceDir(name);
  const devMode = isDevMode();

  // Tolerate pre-existing dir (wizard may have already created zeroclaw/ subdir)
  if (existsSync(join(dir, "cloudclaw.json"))) {
    throw new Error(`Instance "${name}" already exists at ${dir}`);
  }

  console.log(chalk.cyan(`\nCreating instance "${name}"...`));
  console.log(chalk.dim(`  Path: ${dir}`));
  console.log(chalk.dim(`  Mode: ${devMode ? "dev (packed tarballs)" : "production"}`));

  // Create directory
  mkdirSync(dir, { recursive: true });

  // Resolve dependencies
  let deps: Record<string, string>;
  if (devMode) {
    console.log(chalk.cyan("\n  Packing local packages...\n"));
    deps = await packLocalDeps(dir);
  } else {
    deps = {
      "@cloudclaw/provider": "0.1.0",
      "@cloudclaw/app": "0.1.0",
      "zeroclaw": "0.1.0",
    };
  }

  // Write package.json (no cloudclaw metadata — that lives in cloudclaw.json)
  const pkg = buildPackageJson(name, deps);
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

  // Write cloudclaw.json (canonical config)
  writeConfig(name, config);

  // Write .env (derived from config + agent config, for Next.js runtime)
  writeEnvFile(dir, envVars);

  // Install dependencies
  console.log(chalk.cyan("\n  Installing dependencies...\n"));
  await execa("npm", ["install"], {
    cwd: dir,
    stdio: "inherit",
  });

  // Apply templates from installed @cloudclaw/app
  console.log(chalk.cyan("\n  Applying templates..."));
  applyTemplates(dir);

  console.log(chalk.green(`\n  Instance "${name}" created.`));
  return dir;
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

    const pkgPath = join(dir, entry.name, "package.json");
    if (!existsSync(pkgPath)) continue;

    const config = readConfig(entry.name);
    if (!config) continue;

    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as InstancePackageJson;
    instances.push({
      name: entry.name,
      preset: config.instance.preset,
      agent: config.agent.name,
      appVersion: pkg.dependencies?.["@cloudclaw/app"] ?? "unknown",
      deployedUrl: config.instance.deployedUrl,
    });
  }

  return instances;
}

export function getInstance(name: string): InstanceMetadata | null {
  const dir = instanceDir(name);
  const pkgPath = join(dir, "package.json");

  if (!existsSync(pkgPath)) return null;

  const config = readConfig(name);
  if (!config) return null;

  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as InstancePackageJson;
  return {
    name,
    preset: config.instance.preset,
    agent: config.agent.name,
    appVersion: pkg.dependencies?.["@cloudclaw/app"] ?? "unknown",
    deployedUrl: config.instance.deployedUrl,
  };
}

export function instanceExists(name: string): boolean {
  return existsSync(join(instanceDir(name), "package.json"));
}

export function saveDeployedUrl(name: string, url: string): void {
  const config = readConfig(name);
  if (!config) {
    throw new Error(`No cloudclaw.json found for instance "${name}"`);
  }
  config.instance.deployedUrl = url;
  writeConfig(name, config);
}

export async function upgradeInstance(name: string): Promise<void> {
  const dir = instanceDir(name);

  if (!existsSync(dir)) {
    throw new Error(`Instance "${name}" does not exist.`);
  }

  console.log(chalk.cyan(`\nUpgrading instance "${name}"...`));

  // In dev mode, repack local packages to pick up changes
  if (isDevMode()) {
    console.log(chalk.cyan("  Repacking local packages...\n"));
    const deps = await packLocalDeps(dir);

    // Update package.json with new tarball paths
    const pkgPath = join(dir, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as InstancePackageJson;
    Object.assign(pkg.dependencies, deps);
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  }

  // Remove node_modules to force fresh install from new tarballs
  // (npm skips extraction if same version is already installed)
  const nodeModulesDir = join(dir, "node_modules");
  if (existsSync(nodeModulesDir)) {
    console.log(chalk.dim("  Cleaning node_modules..."));
    rmSync(nodeModulesDir, { recursive: true, force: true });
  }

  // Remove stale lock file so npm resolves from new tarballs
  const lockPath = join(dir, "package-lock.json");
  if (existsSync(lockPath)) {
    rmSync(lockPath);
  }

  // Remove .next build cache so Vercel does a clean build
  const nextCacheDir = join(dir, ".next");
  if (existsSync(nextCacheDir)) {
    console.log(chalk.dim("  Cleaning .next cache..."));
    rmSync(nextCacheDir, { recursive: true, force: true });
  }

  // Fresh install
  console.log(chalk.cyan("  Installing dependencies...\n"));
  await execa("npm", ["install"], {
    cwd: dir,
    stdio: "inherit",
  });

  // Reapply templates from the updated @cloudclaw/app
  console.log(chalk.cyan("\n  Reapplying templates..."));
  applyTemplates(dir);

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

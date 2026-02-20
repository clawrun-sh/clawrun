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
  cloudclaw: {
    preset: string;
    agent: string;
    deployedUrl?: string;
  };
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
  preset: string,
  agent: string,
  deps: Record<string, string>,
): InstancePackageJson {
  return {
    name,
    private: true,
    dependencies: {
      ...INSTANCE_PEER_DEPS,
      ...deps,
    },
    cloudclaw: {
      preset,
      agent,
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
  preset: string,
  agent: string,
  envVars: Record<string, string>,
): Promise<string> {
  const dir = instanceDir(name);
  const devMode = isDevMode();

  if (existsSync(dir)) {
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

  // Write package.json
  const pkg = buildPackageJson(name, preset, agent, deps);
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

  // Write .env
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

    try {
      const pkg = JSON.parse(
        readFileSync(pkgPath, "utf-8"),
      ) as InstancePackageJson;

      instances.push({
        name: entry.name,
        preset: pkg.cloudclaw?.preset ?? "unknown",
        agent: pkg.cloudclaw?.agent ?? "unknown",
        appVersion: pkg.dependencies?.["@cloudclaw/app"] ?? "unknown",
        deployedUrl: pkg.cloudclaw?.deployedUrl,
      });
    } catch {
      // skip malformed instances
    }
  }

  return instances;
}

export function getInstance(name: string): InstanceMetadata | null {
  const dir = instanceDir(name);
  const pkgPath = join(dir, "package.json");

  if (!existsSync(pkgPath)) return null;

  try {
    const pkg = JSON.parse(
      readFileSync(pkgPath, "utf-8"),
    ) as InstancePackageJson;

    return {
      name,
      preset: pkg.cloudclaw?.preset ?? "unknown",
      agent: pkg.cloudclaw?.agent ?? "unknown",
      appVersion: pkg.dependencies?.["@cloudclaw/app"] ?? "unknown",
      deployedUrl: pkg.cloudclaw?.deployedUrl,
    };
  } catch {
    return null;
  }
}

export function instanceExists(name: string): boolean {
  return existsSync(join(instanceDir(name), "package.json"));
}

export function saveDeployedUrl(name: string, url: string): void {
  const dir = instanceDir(name);
  const pkgPath = join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as InstancePackageJson;
  pkg.cloudclaw.deployedUrl = url;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
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

/**
 * Patch the vercel.json in an instance directory with a plan-aware cron schedule.
 * Replaces any existing heartbeat cron expression with the provided one.
 */
export function patchVercelJson(dir: string, heartbeatCron: string): void {
  const vercelJsonPath = join(dir, "vercel.json");
  if (!existsSync(vercelJsonPath)) return;

  try {
    const content = readFileSync(vercelJsonPath, "utf-8");
    const config = JSON.parse(content) as {
      crons?: Array<{ path: string; schedule: string }>;
      [key: string]: unknown;
    };

    if (config.crons) {
      for (const cron of config.crons) {
        if (cron.path === "/api/cron/heartbeat") {
          cron.schedule = heartbeatCron;
        }
      }
    }

    writeFileSync(vercelJsonPath, JSON.stringify(config, null, 2) + "\n");
    console.log(chalk.green(`  Heartbeat cron set to: ${heartbeatCron}`));
  } catch {
    console.log(chalk.yellow("  Could not patch vercel.json cron schedule."));
  }
}

export function destroyInstance(name: string): void {
  const dir = instanceDir(name);

  if (!existsSync(dir)) {
    throw new Error(`Instance "${name}" does not exist.`);
  }

  rmSync(dir, { recursive: true, force: true });
  console.log(chalk.green(`  Instance "${name}" destroyed.`));
}

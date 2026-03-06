import { join, resolve, relative } from "node:path";
import { homedir } from "node:os";

/**
 * Validate an instance name to prevent path traversal attacks.
 * Only allows alphanumeric characters, hyphens, and underscores.
 */
function validateInstanceName(name: string): void {
  if (!name || typeof name !== "string") {
    throw new Error("Instance name must be a non-empty string.");
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
    throw new Error(
      `Invalid instance name: "${name}". ` +
        "Names must start with a letter or digit and contain only letters, digits, hyphens, and underscores.",
    );
  }
  // Double-check: resolved path must be a direct child of instancesDir
  const resolved = resolve(join(clawrunHome(), name));
  const rel = relative(clawrunHome(), resolved);
  if (rel !== name || rel.includes("..") || rel.includes("/")) {
    throw new Error(`Invalid instance name: "${name}". Path traversal detected.`);
  }
}

export function clawrunHome(): string {
  return process.env.CLAWRUN_HOME ?? join(homedir(), ".clawrun");
}

export function instancesDir(): string {
  return clawrunHome();
}

export function instanceDir(name: string): string {
  validateInstanceName(name);
  return join(clawrunHome(), name);
}

export function instanceAgentDir(name: string): string {
  return join(instanceDir(name), "agent");
}

export function instanceDeployDir(name: string): string {
  return join(instanceDir(name), ".deploy");
}

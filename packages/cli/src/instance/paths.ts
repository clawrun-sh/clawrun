import { join } from "node:path";
import { homedir } from "node:os";

export function cloudclawHome(): string {
  return process.env.CLOUDCLAW_HOME ?? join(homedir(), ".cloudclaw");
}

export function instancesDir(): string {
  return cloudclawHome();
}

export function instanceDir(name: string): string {
  return join(cloudclawHome(), name);
}

export function instanceAgentDir(name: string): string {
  return join(instanceDir(name), "agent");
}

export function instanceDeployDir(name: string): string {
  return join(instanceDir(name), ".deploy");
}

import { join } from "node:path";
import { homedir } from "node:os";

export function clawrunHome(): string {
  return process.env.CLAWRUN_HOME ?? join(homedir(), ".clawrun");
}

export function instancesDir(): string {
  return clawrunHome();
}

export function instanceDir(name: string): string {
  return join(clawrunHome(), name);
}

export function instanceAgentDir(name: string): string {
  return join(instanceDir(name), "agent");
}

export function instanceDeployDir(name: string): string {
  return join(instanceDir(name), ".deploy");
}

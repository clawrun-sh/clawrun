import { join } from "node:path";
import { homedir } from "node:os";

export function cloudclawHome(): string {
  return process.env.CLOUDCLAW_HOME ?? join(homedir(), ".cloudclaw");
}

export function instancesDir(): string {
  return join(cloudclawHome(), "instances");
}

export function instanceDir(name: string): string {
  return join(instancesDir(), name);
}

import { instanceDir } from "@clawrun/sdk";
import { join } from "node:path";

/** Return the path to clawrun.json for a given instance. Used by tests. */
export function configPath(name: string): string {
  return join(instanceDir(name), "clawrun.json");
}

import type { Preset } from "./types.js";
import { zeroclawBasic } from "./zeroclaw-basic.js";

const presets: Map<string, Preset> = new Map([["zeroclaw-basic", zeroclawBasic]]);

export function getPreset(id: string): Preset | undefined {
  return presets.get(id);
}

export function listPresets(): Preset[] {
  return Array.from(presets.values());
}

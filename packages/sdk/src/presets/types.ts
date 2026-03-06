import { z } from "zod";
import { PROVIDER_IDS } from "@clawrun/provider";

export const PRESET_SCHEMA_URL = "https://clawrun.sh/preset/schema.json";

export const presetSchema = z.object({
  $schema: z.string().optional(),
  id: z.string(),
  name: z.string(),
  agent: z.string(),
  provider: z.enum(PROVIDER_IDS),
  description: z.string(),
});

export type Preset = z.infer<typeof presetSchema>;

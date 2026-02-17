export interface PresetEnvVar {
  key: string;
  prompt: string;
  required: boolean;
  default?: string;
  autoGenerate?: "uuid";
  choices?: string[];
}

export interface Preset {
  id: string;
  name: string;
  agent: string;
  description: string;
  envVars: PresetEnvVar[];
}

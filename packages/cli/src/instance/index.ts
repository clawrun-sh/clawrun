export { cloudclawHome, instancesDir, instanceDir } from "./paths.js";
export {
  createInstance,
  listInstances,
  getInstance,
  instanceExists,
  saveDeployedUrl,
  upgradeInstance,
  destroyInstance,
  patchVercelJson,
  isDevMode,
} from "./manager.js";
export type { InstanceMetadata } from "./manager.js";
export { applyTemplates } from "./templates.js";
export { cloudClawConfigSchema, buildConfig, toEnvVars, readConfig, writeConfig, readAgentConfigJson } from "./config.js";
export type { CloudClawConfig } from "./config.js";

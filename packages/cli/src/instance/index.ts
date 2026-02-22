export { cloudclawHome, instancesDir, instanceDir } from "./paths.js";
export {
  createInstance,
  listInstances,
  getInstance,
  instanceExists,
  saveDeployedUrl,
  upgradeInstance,
  destroyInstance,
  isDevMode,
} from "./manager.js";
export type { InstanceMetadata } from "./manager.js";
export { applyTemplates } from "./templates.js";
export { cloudClawConfigSchema, buildConfig, toEnvVars, readConfig, writeConfig, readAgentConfigJson, generateSecret } from "./config.js";
export type { CloudClawConfig } from "./config.js";

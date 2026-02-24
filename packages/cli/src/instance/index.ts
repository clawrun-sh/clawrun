export { cloudclawHome, instancesDir, instanceDir, instanceAgentDir, instanceDeployDir } from "./paths.js";
export {
  createInstance,
  listInstances,
  getInstance,
  instanceExists,
  saveDeployedUrl,
  upgradeInstance,
  destroyInstance,
  copyMirroredFiles,
  isDevMode,
} from "./manager.js";
export type { InstanceMetadata } from "./manager.js";
export { applyTemplates } from "./templates.js";
export { cloudClawConfigSchema, buildConfig, toEnvVars, readConfig, writeConfig, generateSecret } from "./config.js";
export type { CloudClawConfig } from "./config.js";

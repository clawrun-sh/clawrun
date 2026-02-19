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

export type { AuthResult, WakeSignal, ChannelEnvMapping, WakeHookAdapter } from "./types.js";

export { getAdapter, getAllAdapters, getConfiguredAdapters } from "./registry.js";

export { registerWakeHooks, teardownWakeHooks } from "./manager.js";

export { extractChannelEnvVars, getChannelSecretDefinitions } from "./env.js";

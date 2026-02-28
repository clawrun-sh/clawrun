export type {
  AuthResult,
  WakeSignal,
  WakeHookAdapter,
  ChannelValidationResult,
  ChannelValidator,
} from "./types.js";

export { getAdapter, getAllAdapters, initializeAdapters, hasWakeHook } from "./registry.js";

export { registerWakeHooks, teardownWakeHooks } from "./manager.js";

export { getValidator, getAllValidators, hasValidator, validateChannel } from "./validators.js";

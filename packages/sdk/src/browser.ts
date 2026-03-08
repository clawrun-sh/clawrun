/**
 * Browser-safe SDK exports.
 *
 * This entry point only exports code that can run in the browser
 * (no Node.js built-ins like fs, path, child_process).
 * Used by the web dashboard's client components.
 */
export { ClawRunInstance } from "./instance.js";
export { ApiClient } from "./api-client.js";

export type {
  InstanceConfig,
  InstanceApiConfig,
  ClientOptions,
  ChatOptions,
  ChatStream,
  StartResult,
  StopResult,
  RestartResult,
  HistoryResult,
  InviteResult,
} from "./types.js";

export type {
  ThreadInfo,
  CronJob,
  MemoryEntryInfo,
  AgentStatus,
  CostInfo,
  AgentConfig,
  RuntimeToolInfo,
  CliToolInfo,
  DiagResult,
  HealthResult,
  ToolsResult,
  DiagnosticsResult,
  ThreadsResult,
  ThreadResult,
  MemoriesResult,
  MemoryQuery,
  CreateMemoryInput,
  CronJobsResult,
  CreateCronJobInput,
} from "./types.js";

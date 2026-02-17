export { ZeroClaw } from "./zeroclaw.js";
export { getBinaryPath, ensureBinary } from "./binary.js";
export { parseOutput } from "./output-parser.js";
export { buildAgentCommand, buildOnboardCommand } from "./command-builder.js";

export type {
  ZeroClawConfig,
  ZeroClawResult,
  ChatMessage,
  CommandSpec,
} from "./types.js";

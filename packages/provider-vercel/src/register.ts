import { registerProviderFactory } from "@clawrun/provider";
import { VercelSandboxProvider } from "./vercel.js";

registerProviderFactory("vercel", (options) => new VercelSandboxProvider(options));

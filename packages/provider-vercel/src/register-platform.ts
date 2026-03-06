import { registerPlatformFactory } from "@clawrun/provider";
import { VercelPlatformProvider } from "./vercel-platform.js";

registerPlatformFactory("vercel", () => new VercelPlatformProvider());

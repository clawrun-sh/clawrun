import { ClawRunInstance } from "./instance.js";
import { deploy as deployImpl } from "./deploy.js";
import type {
  ClientOptions,
  InstanceConfig,
  InstanceProviderConfig,
  DeployOptions,
  DeployResult,
} from "./types.js";

/**
 * Top-level entry point for the ClawRun SDK.
 *
 * ```ts
 * import { ClawRunClient } from "@clawrun/sdk";
 *
 * const client = new ClawRunClient();
 *
 * // Connect to an existing deployed instance
 * const instance = client.connect("https://my-agent.vercel.app", "jwt-secret");
 *
 * // Deploy a new instance
 * const result = await client.deploy({
 *   preset: "starter",
 *   agent: {
 *     provider: { provider: "openrouter", apiKey: "sk-...", model: "anthropic/claude-sonnet-4" },
 *   },
 * });
 * ```
 */
export class ClawRunClient {
  private readonly options: ClientOptions;

  constructor(options?: ClientOptions) {
    this.options = options ?? {};
  }

  /**
   * Connect to an existing deployed ClawRun instance.
   *
   * @param url      Base URL of the deployed instance (e.g. "https://my-agent.vercel.app")
   * @param jwtSecret JWT secret for authentication
   * @param sandbox  Optional sandbox provider config for provider-level operations
   */
  connect(url: string, jwtSecret: string, sandbox?: InstanceProviderConfig): ClawRunInstance {
    const config: InstanceConfig = {
      api: { url, jwtSecret },
      sandbox,
    };
    return new ClawRunInstance(config, this.options);
  }

  /**
   * Deploy a new ClawRun instance.
   *
   * Takes all resolved inputs (no interactive prompts) and orchestrates
   * the full deployment: preset resolution, platform setup, state store
   * provisioning, config building, and deployment.
   *
   * Returns the deploy result including a live ClawRunInstance.
   */
  async deploy(options: DeployOptions): Promise<DeployResult> {
    return deployImpl(options);
  }
}

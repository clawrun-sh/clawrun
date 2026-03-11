/**
 * Model pricing lookup using LiteLLM's pricing database.
 *
 * LiteLLM maintains a comprehensive JSON file with pricing for 2500+ models
 * across all major providers. This module fetches it once per CLI run and
 * provides a provider-aware lookup function.
 *
 * @see https://github.com/BerriAI/litellm
 */

const LITELLM_PRICING_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

/** Raw entry shape from LiteLLM's JSON. */
export interface LiteLLMEntry {
  litellm_provider: string;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
  max_tokens?: number;
  mode?: string;
}

/** Resolved pricing info returned by `lookupModelPricing`. */
export interface ModelPricingInfo {
  /** USD per single token (input). Raw LiteLLM value — use for cost calculations. */
  inputCostPerToken: number;
  /** USD per single token (output). Raw LiteLLM value — use for cost calculations. */
  outputCostPerToken: number;
  /** USD per 1M input tokens. Derived from inputCostPerToken — use for display and ZeroClaw config. */
  inputPerMillion: number;
  /** USD per 1M output tokens. Derived from outputCostPerToken — use for display and ZeroClaw config. */
  outputPerMillion: number;
  /** Max input context window (tokens). */
  maxInputTokens?: number;
  /** Max output tokens. */
  maxOutputTokens?: number;
  /** The LiteLLM key that matched. */
  matchedKey: string;
}

/**
 * Maps our provider names (from catalog.ts) to the LiteLLM key prefix
 * and litellm_provider values used in the JSON.
 *
 * Most LiteLLM keys follow `provider/model-id` format. Some providers
 * (OpenAI, Anthropic) also have bare model IDs at the top level.
 */
const PROVIDER_KEY_PREFIXES: Record<string, string[]> = {
  openai: ["", "openai/"],
  anthropic: ["", "anthropic/"],
  openrouter: ["openrouter/"],
  vercel: ["vercel_ai_gateway/"],
  groq: ["groq/"],
  mistral: ["mistral/"],
  deepseek: ["deepseek/", ""],
  gemini: ["gemini/"],
  google: ["gemini/"],
  together: ["together_ai/"],
  fireworks: ["fireworks_ai/"],
  xai: ["xai/"],
  cohere: ["cohere/", "cohere_chat/"],
  perplexity: ["perplexity/"],
  bedrock: ["bedrock/", ""],
  cloudflare: ["cloudflare/"],
  ollama: ["ollama/"],
};

/**
 * Gateway providers where the model ID already contains the sub-provider
 * prefix (e.g. `mistral/mistral-small` on Vercel AI Gateway, or
 * `anthropic/claude-sonnet-4` on OpenRouter). For these, we also try
 * the model ID as-is since it may match a direct provider entry in LiteLLM.
 */
const GATEWAY_PROVIDERS = new Set(["openrouter", "vercel"]);

let cachedData: Record<string, LiteLLMEntry> | null = null;

/**
 * Fetch the LiteLLM pricing database. Cached in memory for the process lifetime.
 * Returns null on network failure (caller should handle gracefully).
 */
export async function fetchPricingData(options?: {
  signal?: AbortSignal;
  url?: string;
}): Promise<Record<string, LiteLLMEntry> | null> {
  if (cachedData) return cachedData;

  try {
    const resp = await fetch(options?.url ?? LITELLM_PRICING_URL, {
      signal: options?.signal ?? AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as Record<string, LiteLLMEntry>;
    // Remove the sample_spec entry if present
    delete json["sample_spec"];
    cachedData = json;
    return cachedData;
  } catch {
    return null;
  }
}

/**
 * Clear the in-memory cache. Useful for testing.
 */
export function clearPricingCache(): void {
  cachedData = null;
}

/**
 * Look up model pricing for a given provider + model ID combination.
 *
 * Tries multiple key patterns since LiteLLM uses different formats:
 * - `provider/modelId` (most common: `groq/llama-3.3-70b-versatile`)
 * - Bare `modelId` (OpenAI: `gpt-4o`, Anthropic: `claude-sonnet-4-20250514`)
 * - `openrouter/subprovider/model` (OpenRouter keeps the sub-provider prefix)
 *
 * Returns null if no match is found or if pricing data couldn't be fetched.
 */
export async function lookupModelPricing(
  provider: string,
  modelId: string,
  options?: { signal?: AbortSignal; data?: Record<string, LiteLLMEntry> },
): Promise<ModelPricingInfo | null> {
  const data = options?.data ?? (await fetchPricingData(options));
  if (!data) return null;

  const entry = resolveEntry(data, provider, modelId);
  if (!entry) return null;

  const { key, value } = entry;

  // Skip entries without pricing (e.g. image models, embeddings)
  if (value.input_cost_per_token == null && value.output_cost_per_token == null) {
    return null;
  }

  return toInfo(key, value);
}

/**
 * Synchronous lookup when you already have the pricing data loaded.
 */
export function lookupModelPricingSync(
  data: Record<string, LiteLLMEntry>,
  provider: string,
  modelId: string,
): ModelPricingInfo | null {
  const entry = resolveEntry(data, provider, modelId);
  if (!entry) return null;

  const { key, value } = entry;

  if (value.input_cost_per_token == null && value.output_cost_per_token == null) {
    return null;
  }

  return toInfo(key, value);
}

/**
 * Estimate cost for a given number of input and output tokens.
 * Uses raw per-token values for maximum precision (single multiplication).
 */
export function costForTokens(
  info: ModelPricingInfo,
  inputTokens: number,
  outputTokens: number,
): number {
  return info.inputCostPerToken * inputTokens + info.outputCostPerToken * outputTokens;
}

/**
 * Format pricing as a human-readable string.
 * Example: "$3.00 / $15.00 per 1M tokens (in/out)"
 */
export function formatPricing(info: ModelPricingInfo): string {
  const fmt = (n: number) => {
    if (n === 0) return "$0.00";
    if (n < 0.01) return `$${n.toFixed(4)}`;
    return `$${n.toFixed(2)}`;
  };
  return `${fmt(info.inputPerMillion)} / ${fmt(info.outputPerMillion)} per 1M tokens (in/out)`;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function toInfo(key: string, value: LiteLLMEntry): ModelPricingInfo {
  const inputCost = value.input_cost_per_token ?? 0;
  const outputCost = value.output_cost_per_token ?? 0;
  return {
    inputCostPerToken: inputCost,
    outputCostPerToken: outputCost,
    inputPerMillion: perMillion(inputCost),
    outputPerMillion: perMillion(outputCost),
    maxInputTokens: value.max_input_tokens,
    maxOutputTokens: value.max_output_tokens ?? value.max_tokens,
    matchedKey: key,
  };
}

/**
 * Convert per-token cost to per-million-token cost with IEEE 754 correction.
 * Some values like 7.9e-7 * 1e6 produce 0.7899999999999999 instead of 0.79.
 * Round to 10 decimal places to eliminate floating-point noise while preserving
 * all meaningful precision from LiteLLM's data.
 */
function perMillion(perToken: number): number {
  return Math.round(perToken * 1e16) / 1e10;
}

function resolveEntry(
  data: Record<string, LiteLLMEntry>,
  provider: string,
  modelId: string,
): { key: string; value: LiteLLMEntry } | null {
  const candidates = buildCandidateKeys(provider, modelId);

  for (const key of candidates) {
    const value = data[key];
    if (value && value.mode === "chat") {
      return { key, value };
    }
  }

  // Retry without mode filter (some models don't have mode set)
  for (const key of candidates) {
    const value = data[key];
    if (value) {
      return { key, value };
    }
  }

  return null;
}

/**
 * Build candidate LiteLLM keys to try, in priority order.
 */
function buildCandidateKeys(provider: string, modelId: string): string[] {
  const keys: string[] = [];
  const normalized = provider.toLowerCase();

  const addUnique = (key: string) => {
    if (!keys.includes(key)) keys.push(key);
  };

  // 1. Provider-specific prefixes from our mapping
  const prefixes = PROVIDER_KEY_PREFIXES[normalized];
  if (prefixes) {
    for (const prefix of prefixes) {
      addUnique(`${prefix}${modelId}`);
    }
  }

  // 2. Gateway providers: model ID already contains sub-provider prefix
  //    (e.g. "anthropic/claude-sonnet-4.6" on Vercel, "anthropic/claude-sonnet-4" on OpenRouter).
  //    Try gateway-specific variations (with dot-to-dash normalization).
  //    Do NOT fall back to the underlying provider's direct pricing — gateway
  //    pricing differs and showing wrong numbers is worse than showing none.
  if (GATEWAY_PROVIDERS.has(normalized)) {
    if (modelId.includes("/")) {
      // Dot-to-dash normalization on full model ID for gateway prefix
      const dashModelId = modelId.replace(/\./g, "-");
      if (prefixes) {
        for (const prefix of prefixes) {
          if (dashModelId !== modelId) addUnique(`${prefix}${dashModelId}`);
        }
      }
    }
    // Gateway providers: stop here. No fallback to underlying provider.
    return keys;
  }

  // 3. Strip sub-provider prefix for bare model lookup.
  //    "anthropic/claude-sonnet-4.6" → try "claude-sonnet-4.6" and "claude-sonnet-4-6"
  if (modelId.includes("/")) {
    const bare = modelId.split("/").pop()!;
    addUnique(bare);
    // Dot-to-dash normalization (Vercel uses dots, LiteLLM often uses dashes)
    const dashNormalized = bare.replace(/\./g, "-");
    if (dashNormalized !== bare) {
      addUnique(dashNormalized);
    }
  }

  // 4. Generic: try provider/modelId
  if (!prefixes?.includes(`${normalized}/`)) {
    addUnique(`${normalized}/${modelId}`);
  }

  // 5. Bare model ID
  addUnique(modelId);

  // 6. Dot-to-dash normalization on the full model ID
  const dashModelId = modelId.replace(/\./g, "-");
  if (dashModelId !== modelId) {
    // Re-run prefix strategies with dash-normalized ID
    if (prefixes) {
      for (const prefix of prefixes) {
        addUnique(`${prefix}${dashModelId}`);
      }
    }
    addUnique(dashModelId);
  }

  return keys;
}

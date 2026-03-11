import { describe, it, expect, beforeEach } from "vitest";
import {
  lookupModelPricingSync,
  formatPricing,
  costForTokens,
  clearPricingCache,
  type LiteLLMEntry,
  type ModelPricingInfo,
} from "./pricing.js";

/** Minimal mock data resembling LiteLLM's pricing JSON. */
function makeMockData(): Record<string, LiteLLMEntry> {
  return {
    // Anthropic — bare model ID
    "claude-sonnet-4-20250514": {
      litellm_provider: "anthropic",
      input_cost_per_token: 3e-6,
      output_cost_per_token: 1.5e-5,
      max_input_tokens: 200_000,
      max_output_tokens: 64_000,
      mode: "chat",
    },
    "claude-haiku-4-5-20251001": {
      litellm_provider: "anthropic",
      input_cost_per_token: 1e-6,
      output_cost_per_token: 5e-6,
      max_input_tokens: 200_000,
      max_output_tokens: 8192,
      mode: "chat",
    },

    // OpenAI — bare model ID
    "gpt-4o": {
      litellm_provider: "openai",
      input_cost_per_token: 2.5e-6,
      output_cost_per_token: 1e-5,
      max_input_tokens: 128_000,
      max_output_tokens: 16_384,
      mode: "chat",
    },

    // OpenRouter — triple-prefixed
    "openrouter/anthropic/claude-sonnet-4": {
      litellm_provider: "openrouter",
      input_cost_per_token: 3e-6,
      output_cost_per_token: 1.5e-5,
      max_input_tokens: 200_000,
      max_output_tokens: 64_000,
      mode: "chat",
    },
    "openrouter/openai/gpt-4o": {
      litellm_provider: "openrouter",
      input_cost_per_token: 2.5e-6,
      output_cost_per_token: 1e-5,
      max_input_tokens: 128_000,
      max_output_tokens: 16_384,
      mode: "chat",
    },

    // Groq — provider-prefixed
    "groq/llama-3.3-70b-versatile": {
      litellm_provider: "groq",
      input_cost_per_token: 5.9e-7,
      output_cost_per_token: 7.9e-7,
      max_input_tokens: 128_000,
      max_output_tokens: 32_768,
      mode: "chat",
    },

    // DeepSeek — both bare and prefixed
    "deepseek-chat": {
      litellm_provider: "deepseek",
      input_cost_per_token: 2.8e-7,
      output_cost_per_token: 4.2e-7,
      max_input_tokens: 128_000,
      max_output_tokens: 8192,
      mode: "chat",
    },
    "deepseek/deepseek-chat": {
      litellm_provider: "deepseek",
      input_cost_per_token: 2.8e-7,
      output_cost_per_token: 4.2e-7,
      max_input_tokens: 128_000,
      max_output_tokens: 8192,
      mode: "chat",
    },

    // Mistral — prefixed
    "mistral/mistral-large-latest": {
      litellm_provider: "mistral",
      input_cost_per_token: 2e-6,
      output_cost_per_token: 6e-6,
      max_input_tokens: 128_000,
      max_output_tokens: 8192,
      mode: "chat",
    },

    // Gemini — prefixed
    "gemini/gemini-2.0-flash": {
      litellm_provider: "gemini",
      input_cost_per_token: 7.5e-8,
      output_cost_per_token: 3e-7,
      max_input_tokens: 1_048_576,
      max_output_tokens: 8192,
      mode: "chat",
    },

    // Vercel AI Gateway — gateway prefix with sub-provider
    "vercel_ai_gateway/mistral/mistral-small": {
      litellm_provider: "vercel_ai_gateway",
      input_cost_per_token: 1e-7,
      output_cost_per_token: 3e-7,
      max_input_tokens: 32_000,
      max_output_tokens: 8192,
      mode: "chat",
    },
    "vercel_ai_gateway/anthropic/claude-4-sonnet": {
      litellm_provider: "vercel_ai_gateway",
      input_cost_per_token: 3e-6,
      output_cost_per_token: 1.5e-5,
      max_input_tokens: 200_000,
      max_output_tokens: 64_000,
      mode: "chat",
    },

    // Together — prefixed
    "together_ai/meta-llama/Llama-3-70b-chat-hf": {
      litellm_provider: "together_ai",
      input_cost_per_token: 9e-7,
      output_cost_per_token: 9e-7,
      max_input_tokens: 8192,
      max_tokens: 4096,
      mode: "chat",
    },

    // Image model (should be skipped — no token pricing)
    "dall-e-3": {
      litellm_provider: "openai",
      input_cost_per_token: undefined,
      output_cost_per_token: undefined,
      mode: "image_generation",
    } as unknown as LiteLLMEntry,

    // Embedding model (has input cost only)
    "text-embedding-3-small": {
      litellm_provider: "openai",
      input_cost_per_token: 2e-8,
      output_cost_per_token: undefined,
      mode: "embedding",
    } as unknown as LiteLLMEntry,
  };
}

describe("lookupModelPricingSync", () => {
  let data: Record<string, LiteLLMEntry>;

  beforeEach(() => {
    data = makeMockData();
    clearPricingCache();
  });

  // --- Direct provider lookups ---

  it("finds Anthropic models by bare model ID", () => {
    const result = lookupModelPricingSync(data, "anthropic", "claude-sonnet-4-20250514")!;
    // Raw per-token values preserved from LiteLLM
    expect(result.inputCostPerToken).toBe(3e-6);
    expect(result.outputCostPerToken).toBe(1.5e-5);
    // Derived per-million values
    expect(result.inputPerMillion).toBe(3);
    expect(result.outputPerMillion).toBe(15);
    expect(result.maxInputTokens).toBe(200_000);
    expect(result.matchedKey).toBe("claude-sonnet-4-20250514");
  });

  it("finds OpenAI models by bare model ID", () => {
    const result = lookupModelPricingSync(data, "openai", "gpt-4o")!;
    expect(result.inputPerMillion).toBe(2.5);
    expect(result.outputPerMillion).toBe(10);
    expect(result.matchedKey).toBe("gpt-4o");
  });

  it("finds OpenRouter models with sub-provider prefix", () => {
    const result = lookupModelPricingSync(data, "openrouter", "anthropic/claude-sonnet-4")!;
    expect(result.inputPerMillion).toBe(3);
    expect(result.matchedKey).toBe("openrouter/anthropic/claude-sonnet-4");
  });

  it("finds Groq models with prefix", () => {
    const result = lookupModelPricingSync(data, "groq", "llama-3.3-70b-versatile")!;
    expect(result.inputPerMillion).toBe(0.59);
    expect(result.outputPerMillion).toBe(0.79);
    expect(result.matchedKey).toBe("groq/llama-3.3-70b-versatile");
  });

  it("finds DeepSeek models (prefers prefixed)", () => {
    const result = lookupModelPricingSync(data, "deepseek", "deepseek-chat")!;
    expect(result.inputPerMillion).toBe(0.28);
    expect(result.matchedKey).toBe("deepseek/deepseek-chat");
  });

  it("finds Mistral models with prefix", () => {
    const result = lookupModelPricingSync(data, "mistral", "mistral-large-latest")!;
    expect(result.inputPerMillion).toBe(2);
    expect(result.outputPerMillion).toBe(6);
    expect(result.matchedKey).toBe("mistral/mistral-large-latest");
  });

  it("finds Gemini models with prefix", () => {
    const result = lookupModelPricingSync(data, "gemini", "gemini-2.0-flash")!;
    expect(result.inputPerMillion).toBe(0.075);
    expect(result.outputPerMillion).toBe(0.3);
    expect(result.maxInputTokens).toBe(1_048_576);
    expect(result.matchedKey).toBe("gemini/gemini-2.0-flash");
  });

  it("finds Gemini models via 'google' provider alias", () => {
    const result = lookupModelPricingSync(data, "google", "gemini-2.0-flash")!;
    expect(result.matchedKey).toBe("gemini/gemini-2.0-flash");
  });

  it("finds Vercel AI Gateway models with gateway prefix", () => {
    const result = lookupModelPricingSync(data, "vercel", "mistral/mistral-small")!;
    expect(result.inputPerMillion).toBe(0.1);
    expect(result.outputPerMillion).toBe(0.3);
    expect(result.matchedKey).toBe("vercel_ai_gateway/mistral/mistral-small");
  });

  it("finds Vercel AI Gateway Anthropic models", () => {
    const result = lookupModelPricingSync(data, "vercel", "anthropic/claude-4-sonnet")!;
    expect(result.inputPerMillion).toBe(3);
    expect(result.matchedKey).toBe("vercel_ai_gateway/anthropic/claude-4-sonnet");
  });

  it("returns null for Vercel gateway models not in LiteLLM", () => {
    // vercel_ai_gateway/mistral/mistral-large-latest doesn't exist in mock.
    // Should NOT fall back to mistral/mistral-large-latest (different pricing).
    const result = lookupModelPricingSync(data, "vercel", "mistral/mistral-large-latest");
    expect(result).toBeNull();
  });

  it("resolves Vercel gateway model via dot-to-dash normalization on gateway key", () => {
    // Vercel serves "anthropic/claude-sonnet-4.6" — should try
    // "vercel_ai_gateway/anthropic/claude-sonnet-4-6" (dot-to-dash on gateway prefix)
    data["vercel_ai_gateway/anthropic/claude-sonnet-4-6"] = {
      litellm_provider: "vercel_ai_gateway",
      input_cost_per_token: 3e-6,
      output_cost_per_token: 1.5e-5,
      max_input_tokens: 200_000,
      max_output_tokens: 64_000,
      mode: "chat",
    };
    const result = lookupModelPricingSync(data, "vercel", "anthropic/claude-sonnet-4.6")!;
    expect(result.inputPerMillion).toBe(3);
    expect(result.matchedKey).toBe("vercel_ai_gateway/anthropic/claude-sonnet-4-6");
  });

  it("does not fall back to OpenRouter or bare model for Vercel gateway", () => {
    // Even if openrouter/anthropic/claude-sonnet-4.6 exists,
    // Vercel should NOT use it — gateway pricing differs
    data["openrouter/anthropic/claude-sonnet-4.6"] = {
      litellm_provider: "openrouter",
      input_cost_per_token: 3e-6,
      output_cost_per_token: 1.5e-5,
      max_input_tokens: 200_000,
      max_output_tokens: 64_000,
      mode: "chat",
    };
    const result = lookupModelPricingSync(data, "vercel", "anthropic/claude-sonnet-4.6");
    expect(result).toBeNull();
  });

  it("finds Together AI models with prefix", () => {
    const result = lookupModelPricingSync(data, "together", "meta-llama/Llama-3-70b-chat-hf")!;
    expect(result.inputPerMillion).toBe(0.9);
    // max_tokens used as fallback for max_output_tokens
    expect(result.maxOutputTokens).toBe(4096);
    expect(result.matchedKey).toBe("together_ai/meta-llama/Llama-3-70b-chat-hf");
  });

  // --- Edge cases ---

  it("returns null for unknown model", () => {
    expect(lookupModelPricingSync(data, "openai", "nonexistent-model-xyz")).toBeNull();
  });

  it("returns null for unknown provider with unknown model", () => {
    expect(lookupModelPricingSync(data, "unknown-provider", "unknown-model")).toBeNull();
  });

  it("returns null for image generation models (no token pricing)", () => {
    expect(lookupModelPricingSync(data, "openai", "dall-e-3")).toBeNull();
  });

  it("returns pricing for embedding models that have input cost", () => {
    const result = lookupModelPricingSync(data, "openai", "text-embedding-3-small")!;
    expect(result.inputPerMillion).toBe(0.02);
    expect(result.outputPerMillion).toBe(0);
  });

  it("handles provider name case-insensitively", () => {
    const result = lookupModelPricingSync(data, "OpenAI", "gpt-4o")!;
    expect(result.matchedKey).toBe("gpt-4o");
  });

  it("prefers chat mode entries when multiple matches exist", () => {
    data["openai/gpt-4o"] = {
      litellm_provider: "openai",
      input_cost_per_token: 9.99e-6,
      output_cost_per_token: 9.99e-5,
      max_input_tokens: 128_000,
      max_output_tokens: 16_384,
      mode: "completion",
    };
    // Bare "gpt-4o" with mode "chat" should still be preferred
    const result = lookupModelPricingSync(data, "openai", "gpt-4o")!;
    expect(result.inputPerMillion).toBe(2.5);
  });
});

describe("formatPricing", () => {
  it("formats typical pricing", () => {
    const info: ModelPricingInfo = {
      inputCostPerToken: 3e-6,
      outputCostPerToken: 1.5e-5,
      inputPerMillion: 3.0,
      outputPerMillion: 15.0,
      matchedKey: "test",
    };
    expect(formatPricing(info)).toBe("$3.00 / $15.00 per 1M tokens (in/out)");
  });

  it("formats zero pricing", () => {
    const info: ModelPricingInfo = {
      inputCostPerToken: 0,
      outputCostPerToken: 0,
      inputPerMillion: 0,
      outputPerMillion: 0,
      matchedKey: "test",
    };
    expect(formatPricing(info)).toBe("$0.00 / $0.00 per 1M tokens (in/out)");
  });

  it("formats sub-cent pricing with extra decimals", () => {
    const info: ModelPricingInfo = {
      inputCostPerToken: 5e-9,
      outputCostPerToken: 8e-9,
      inputPerMillion: 0.005,
      outputPerMillion: 0.008,
      matchedKey: "test",
    };
    expect(formatPricing(info)).toBe("$0.0050 / $0.0080 per 1M tokens (in/out)");
  });

  it("formats cheap models", () => {
    const info: ModelPricingInfo = {
      inputCostPerToken: 7.5e-8,
      outputCostPerToken: 3e-7,
      inputPerMillion: 0.075,
      outputPerMillion: 0.3,
      matchedKey: "test",
    };
    expect(formatPricing(info)).toBe("$0.07 / $0.30 per 1M tokens (in/out)");
  });

  it("formats expensive models", () => {
    const info: ModelPricingInfo = {
      inputCostPerToken: 1.5e-5,
      outputCostPerToken: 7.5e-5,
      inputPerMillion: 15,
      outputPerMillion: 75,
      matchedKey: "test",
    };
    expect(formatPricing(info)).toBe("$15.00 / $75.00 per 1M tokens (in/out)");
  });
});

describe("costForTokens", () => {
  it("calculates cost using raw per-token values", () => {
    const info = lookupModelPricingSync(makeMockData(), "anthropic", "claude-sonnet-4-20250514")!;
    // 1000 input tokens at $3/1M + 500 output tokens at $15/1M
    // = 1000 * 3e-6 + 500 * 1.5e-5 = 0.003 + 0.0075 = 0.0105
    const cost = costForTokens(info, 1000, 500);
    expect(cost).toBe(0.0105);
  });

  it("calculates cost for cheap models without precision loss", () => {
    const info = lookupModelPricingSync(makeMockData(), "groq", "llama-3.3-70b-versatile")!;
    // 10000 input + 5000 output
    // = 10000 * 5.9e-7 + 5000 * 7.9e-7 = 0.0059 + 0.00395 = 0.00985
    const cost = costForTokens(info, 10_000, 5_000);
    expect(cost).toBe(0.00985);
  });

  it("handles zero tokens", () => {
    const info = lookupModelPricingSync(makeMockData(), "openai", "gpt-4o")!;
    expect(costForTokens(info, 0, 0)).toBe(0);
  });
});

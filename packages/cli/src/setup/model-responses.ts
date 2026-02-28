import { z } from "zod";

// OpenAI-compatible: OpenAI, OpenRouter, Groq, Mistral, DeepSeek, xAI, Together, Fireworks, Venice, Novita, Perplexity
export const openAiModelsResponse = z.object({
  data: z.array(z.object({ id: z.string() })),
});

// Ollama
export const ollamaModelsResponse = z.object({
  models: z.array(z.object({ name: z.string() })),
});

// Google Gemini
export const geminiModelsResponse = z.object({
  models: z.array(z.object({ name: z.string() })),
});

// Anthropic (also OpenAI-compatible shape)
export const anthropicModelsResponse = z.object({
  data: z.array(z.object({ id: z.string() })),
});

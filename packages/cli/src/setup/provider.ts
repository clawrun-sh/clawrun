import * as clack from "@clack/prompts";
import type { Agent, ProviderSetup } from "@clawrun/agent";
import {
  openAiModelsResponse,
  ollamaModelsResponse,
  geminiModelsResponse,
} from "./model-responses.js";

const TIER_HINTS: Record<string, string> = {
  recommended: "recommended",
  fast: "fast inference",
  gateway: "gateway / proxy",
  specialized: "specialized",
  local: "local / private",
};

async function fetchModels(
  agent: Agent,
  provider: string,
  apiKey: string,
  apiUrl?: string,
): Promise<string[]> {
  const endpoint = agent.getModelsFetchEndpoint(provider, apiUrl);
  if (!endpoint) return [];

  let url = endpoint.url;
  // Gemini uses query param for auth
  if (provider === "gemini") {
    url += `?key=${apiKey}`;
  }

  const headers: Record<string, string> = {
    ...endpoint.authHeader(apiKey),
  };

  const resp = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) return [];
  const json = await resp.json();

  // Try OpenAI-compatible first (covers most providers + Anthropic)
  const openai = openAiModelsResponse.safeParse(json);
  if (openai.success) {
    return openai.data.data.map((m) => m.id);
  }

  // Ollama
  const ollama = ollamaModelsResponse.safeParse(json);
  if (ollama.success) {
    return ollama.data.models.map((m) => m.name);
  }

  // Gemini
  const gemini = geminiModelsResponse.safeParse(json);
  if (gemini.success) {
    return gemini.data.models.map((m) => m.name.replace(/^models\//, ""));
  }

  return [];
}

export async function promptProvider(
  agent: Agent,
  existing?: Partial<ProviderSetup>,
): Promise<ProviderSetup> {
  const providers = agent.getProviders();

  // Provider selection
  const providerChoice = await clack.autocomplete({
    message: "LLM provider",
    options: providers.map((p) => ({
      value: p.name,
      label: p.displayName,
      hint: TIER_HINTS[p.tier],
    })),
    initialValue: existing?.provider ?? providers[0]?.name,
    placeholder: "Type to search all providers...",
    maxItems: 10,
  });

  if (clack.isCancel(providerChoice)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }

  const provider = providerChoice as string;

  // API key
  let apiKey = "";
  if (provider === "ollama") {
    apiKey = "";
  } else {
    const keyPrompt = existing?.apiKey
      ? `API key for ${provider} (Enter to keep current)`
      : `API key for ${provider}`;

    const keyInput = await clack.password({
      message: keyPrompt,
      validate: (v) => {
        if (!v && !existing?.apiKey) return "API key is required";
        return undefined;
      },
    });

    if (clack.isCancel(keyInput)) {
      clack.cancel("Setup cancelled.");
      process.exit(0);
    }

    apiKey = (keyInput as string) || existing?.apiKey || "";
  }

  // Custom API URL (only for ollama or if user needs it)
  let apiUrl: string | undefined;
  if (provider === "ollama") {
    const urlInput = await clack.text({
      message: "Ollama URL",
      defaultValue: existing?.apiUrl ?? "http://127.0.0.1:11434",
      placeholder: "http://127.0.0.1:11434",
    });

    if (clack.isCancel(urlInput)) {
      clack.cancel("Setup cancelled.");
      process.exit(0);
    }

    apiUrl = urlInput as string;
  }

  // Model selection — autocomplete with curated + live models
  const defaultModel = agent.getDefaultModel(provider);
  const curatedModels = agent.getCuratedModels(provider);
  let model = defaultModel;
  let liveModels: string[] = [];

  if (apiKey || provider === "ollama") {
    const s = clack.spinner();
    s.start("Fetching available models...");
    try {
      liveModels = await fetchModels(agent, provider, apiKey, apiUrl);
      if (liveModels.length > 0) {
        s.stop(`Found ${liveModels.length} models`);
      } else {
        s.error(
          curatedModels.length > 0
            ? "Could not fetch models \u2014 showing curated list"
            : "Could not fetch models \u2014 using manual input",
        );
      }
    } catch {
      s.error(
        curatedModels.length > 0
          ? "Could not fetch models \u2014 showing curated list"
          : "Could not fetch models \u2014 using manual input",
      );
    }
  }

  // Build unified option list: curated first, then remaining live models
  const curatedIds = new Set(curatedModels.map((m) => m.id));
  const options: Array<{ value: string; label: string; hint?: string }> = [];

  for (const m of curatedModels) {
    options.push({
      value: m.id,
      label: m.label,
      hint: m.id === defaultModel ? "default" : undefined,
    });
  }

  // Add live models that aren't already in the curated list
  for (const id of liveModels) {
    if (!curatedIds.has(id)) {
      options.push({ value: id, label: id });
    }
  }

  // Always offer manual input as a fallback
  options.push({ value: "__other__", label: "Other (type manually)" });

  if (options.length > 2) {
    // Enough options for autocomplete to be useful
    const modelChoice = await clack.autocomplete({
      message: "Model",
      options,
      initialValue: existing?.model ?? defaultModel,
      placeholder: "Type to search all models...",
      maxItems: 10,
    });

    if (clack.isCancel(modelChoice)) {
      clack.cancel("Setup cancelled.");
      process.exit(0);
    }

    if (modelChoice === "__other__") {
      model = await promptManualModel(existing?.model ?? defaultModel);
    } else {
      model = modelChoice as string;
    }
  } else {
    // Only "Other" option — go straight to manual input
    model = await promptManualModel(existing?.model ?? defaultModel);
  }

  return { provider, apiKey, model, apiUrl };
}

async function promptManualModel(defaultValue: string): Promise<string> {
  const input = await clack.text({
    message: "Model name",
    defaultValue,
  });

  if (clack.isCancel(input)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }

  return input as string;
}

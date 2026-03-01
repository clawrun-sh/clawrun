import type { ProviderInfo, CuratedModel, ChannelInfo } from "@clawrun/agent";

// --- Providers ---

export const PROVIDERS: ProviderInfo[] = [
  // Recommended
  { name: "openrouter", displayName: "OpenRouter", tier: "recommended" },
  { name: "venice", displayName: "Venice AI", tier: "recommended" },
  { name: "anthropic", displayName: "Anthropic", tier: "recommended" },
  { name: "openai", displayName: "OpenAI", tier: "recommended" },
  { name: "openai-codex", displayName: "OpenAI Codex (ChatGPT OAuth)", tier: "recommended" },
  { name: "deepseek", displayName: "DeepSeek", tier: "recommended" },
  { name: "mistral", displayName: "Mistral", tier: "recommended" },
  { name: "xai", displayName: "xAI (Grok)", tier: "recommended" },
  { name: "perplexity", displayName: "Perplexity", tier: "recommended" },
  { name: "gemini", displayName: "Google Gemini", tier: "recommended" },
  // Fast inference
  { name: "groq", displayName: "Groq", tier: "fast" },
  { name: "fireworks", displayName: "Fireworks AI", tier: "fast" },
  { name: "novita", displayName: "Novita AI", tier: "fast" },
  { name: "together-ai", displayName: "Together AI", tier: "fast" },
  { name: "nvidia", displayName: "NVIDIA NIM", tier: "fast" },
  // Gateway / proxy
  { name: "vercel", displayName: "Vercel AI Gateway", tier: "gateway" },
  { name: "cloudflare", displayName: "Cloudflare AI Gateway", tier: "gateway" },
  { name: "astrai", displayName: "Astrai", tier: "gateway" },
  { name: "bedrock", displayName: "Amazon Bedrock", tier: "gateway" },
  // Specialized
  { name: "kimi-code", displayName: "Kimi Code", tier: "specialized" },
  { name: "qwen-code", displayName: "Qwen Code (OAuth)", tier: "specialized" },
  { name: "moonshot", displayName: "Moonshot (China)", tier: "specialized" },
  { name: "moonshot-intl", displayName: "Moonshot (International)", tier: "specialized" },
  { name: "glm", displayName: "GLM / Zhipu (International)", tier: "specialized" },
  { name: "glm-cn", displayName: "GLM / Zhipu (China)", tier: "specialized" },
  { name: "minimax", displayName: "MiniMax (International)", tier: "specialized" },
  { name: "minimax-cn", displayName: "MiniMax (China)", tier: "specialized" },
  { name: "qwen", displayName: "Qwen / DashScope (China)", tier: "specialized" },
  { name: "qwen-coding-plan", displayName: "Qwen Coding Plan", tier: "specialized" },
  { name: "qwen-intl", displayName: "Qwen (International)", tier: "specialized" },
  { name: "qwen-us", displayName: "Qwen (US)", tier: "specialized" },
  { name: "hunyuan", displayName: "Hunyuan (Tencent)", tier: "specialized" },
  { name: "qianfan", displayName: "Qianfan (Baidu)", tier: "specialized" },
  { name: "zai", displayName: "Z.AI (Global)", tier: "specialized" },
  { name: "zai-cn", displayName: "Z.AI (China)", tier: "specialized" },
  { name: "synthetic", displayName: "Synthetic", tier: "specialized" },
  { name: "opencode", displayName: "OpenCode Zen", tier: "specialized" },
  { name: "cohere", displayName: "Cohere", tier: "specialized" },
  // Local / private
  { name: "ollama", displayName: "Ollama", tier: "local" },
  { name: "lmstudio", displayName: "LM Studio", tier: "local" },
  { name: "llamacpp", displayName: "llama.cpp", tier: "local" },
  { name: "sglang", displayName: "SGLang", tier: "local" },
  { name: "vllm", displayName: "vLLM", tier: "local" },
  { name: "osaurus", displayName: "Osaurus", tier: "local" },
];

// --- Default models ---

const DEFAULT_MODELS: Record<string, string> = {
  openrouter: "anthropic/claude-sonnet-4.6",
  anthropic: "claude-sonnet-4-5-20250929",
  openai: "gpt-5.2",
  "openai-codex": "gpt-5-codex",
  gemini: "gemini-2.5-pro",
  deepseek: "deepseek-chat",
  xai: "grok-4-1-fast-reasoning",
  venice: "zai-org-glm-5",
  groq: "llama-3.3-70b-versatile",
  mistral: "mistral-large-latest",
  perplexity: "sonar-pro",
  fireworks: "accounts/fireworks/models/llama-v3p3-70b-instruct",
  "together-ai": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  novita: "minimax/minimax-m2.5",
  cohere: "command-a-03-2025",
  moonshot: "kimi-k2.5",
  "moonshot-intl": "kimi-k2.5",
  "kimi-code": "kimi-for-coding",
  "qwen-code": "qwen3-coder-plus",
  glm: "glm-5",
  "glm-cn": "glm-5",
  zai: "glm-5",
  "zai-cn": "glm-5",
  minimax: "MiniMax-M2.5",
  "minimax-cn": "MiniMax-M2.5",
  qwen: "qwen-plus",
  "qwen-intl": "qwen-plus",
  "qwen-us": "qwen-plus",
  "qwen-coding-plan": "qwen3-coder-plus",
  hunyuan: "hunyuan-t1-latest",
  bedrock: "anthropic.claude-sonnet-4-5-20250929-v1:0",
  nvidia: "meta/llama-3.3-70b-instruct",
  astrai: "anthropic/claude-sonnet-4.6",
  ollama: "llama3.2",
  llamacpp: "ggml-org/gpt-oss-20b-GGUF",
  sglang: "meta-llama/Llama-3.1-8B-Instruct",
  vllm: "meta-llama/Llama-3.1-8B-Instruct",
  osaurus: "qwen3-30b-a3b-8bit",
};

export function getDefaultModel(provider: string): string {
  return DEFAULT_MODELS[provider] ?? "anthropic/claude-sonnet-4.6";
}

// --- Curated models ---

const CURATED_MODELS: Record<string, CuratedModel[]> = {
  openrouter: [
    { id: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6 (balanced, recommended)" },
    { id: "openai/gpt-5.2", label: "GPT-5.2 (latest flagship)" },
    { id: "openai/gpt-5-mini", label: "GPT-5 mini (fast, cost-efficient)" },
    { id: "google/gemini-3-pro-preview", label: "Gemini 3 Pro Preview (frontier reasoning)" },
    { id: "x-ai/grok-4.1-fast", label: "Grok 4.1 Fast (reasoning + speed)" },
    { id: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2 (agentic + affordable)" },
    { id: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick (open model)" },
  ],
  anthropic: [
    { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5 (balanced, recommended)" },
    { id: "claude-opus-4-6", label: "Claude Opus 4.6 (best quality)" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (fastest, cheapest)" },
  ],
  openai: [
    { id: "gpt-5.2", label: "GPT-5.2 (latest coding/agentic flagship)" },
    { id: "gpt-5-mini", label: "GPT-5 mini (faster, cheaper)" },
    { id: "gpt-5-nano", label: "GPT-5 nano (lowest latency/cost)" },
    { id: "gpt-5.2-codex", label: "GPT-5.2 Codex (agentic coding)" },
  ],
  "openai-codex": [
    { id: "gpt-5-codex", label: "GPT-5 Codex (recommended)" },
    { id: "gpt-5.2-codex", label: "GPT-5.2 Codex (agentic coding)" },
    { id: "o4-mini", label: "o4-mini (fallback)" },
  ],
  gemini: [
    { id: "gemini-3-pro-preview", label: "Gemini 3 Pro Preview (latest frontier reasoning)" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro (stable reasoning)" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (best price/performance)" },
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite (lowest cost)" },
  ],
  deepseek: [
    { id: "deepseek-chat", label: "DeepSeek Chat (V3.2 non-thinking)" },
    { id: "deepseek-reasoner", label: "DeepSeek Reasoner (V3.2 thinking)" },
  ],
  xai: [
    { id: "grok-4-1-fast-reasoning", label: "Grok 4.1 Fast Reasoning (recommended)" },
    { id: "grok-4-1-fast-non-reasoning", label: "Grok 4.1 Fast Non-Reasoning (low latency)" },
    { id: "grok-code-fast-1", label: "Grok Code Fast 1 (coding specialist)" },
    { id: "grok-4", label: "Grok 4 (max quality)" },
  ],
  venice: [
    { id: "zai-org-glm-5", label: "GLM-5 via Venice (agentic flagship)" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 via Venice (best quality)" },
    { id: "deepseek-v3.2", label: "DeepSeek V3.2 via Venice (strong value)" },
    { id: "grok-41-fast", label: "Grok 4.1 Fast via Venice (low latency)" },
  ],
  groq: [
    { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (fast, recommended)" },
    { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B (strong open-weight)" },
    { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B (cost-efficient open-weight)" },
  ],
  mistral: [
    { id: "mistral-large-latest", label: "Mistral Large (latest flagship)" },
    { id: "mistral-medium-latest", label: "Mistral Medium (balanced)" },
    { id: "codestral-latest", label: "Codestral (code-focused)" },
    { id: "devstral-latest", label: "Devstral (software engineering specialist)" },
  ],
  perplexity: [
    { id: "sonar-pro", label: "Sonar Pro (flagship web-grounded)" },
    { id: "sonar-reasoning-pro", label: "Sonar Reasoning Pro (multi-step reasoning)" },
    { id: "sonar-deep-research", label: "Sonar Deep Research (long-form research)" },
    { id: "sonar", label: "Sonar (search, fast)" },
  ],
  fireworks: [
    { id: "accounts/fireworks/models/llama-v3p3-70b-instruct", label: "Llama 3.3 70B" },
    { id: "accounts/fireworks/models/mixtral-8x22b-instruct", label: "Mixtral 8x22B" },
  ],
  "together-ai": [
    {
      id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      label: "Llama 3.3 70B Instruct Turbo (recommended)",
    },
    { id: "moonshotai/Kimi-K2.5", label: "Kimi K2.5 (reasoning + coding)" },
    { id: "deepseek-ai/DeepSeek-V3.1", label: "DeepSeek V3.1 (strong value)" },
  ],
  novita: [{ id: "minimax/minimax-m2.5", label: "MiniMax M2.5" }],
  cohere: [
    { id: "command-a-03-2025", label: "Command A (flagship enterprise)" },
    { id: "command-a-reasoning-08-2025", label: "Command A Reasoning (agentic reasoning)" },
    { id: "command-r-08-2024", label: "Command R (stable fast baseline)" },
  ],
  "kimi-code": [
    { id: "kimi-for-coding", label: "Kimi for Coding (official coding-agent model)" },
    { id: "kimi-k2.5", label: "Kimi K2.5 (general coding endpoint model)" },
  ],
  "qwen-code": [
    { id: "qwen3-coder-plus", label: "Qwen3 Coder Plus (recommended for coding)" },
    { id: "qwen3.5-plus", label: "Qwen3.5 Plus (reasoning + coding)" },
    { id: "qwen3-max-2026-01-23", label: "Qwen3 Max (high-capability coding model)" },
  ],
  moonshot: [
    { id: "kimi-k2.5", label: "Kimi K2.5 (latest flagship, recommended)" },
    { id: "kimi-k2-thinking", label: "Kimi K2 Thinking (deep reasoning + tool use)" },
    { id: "kimi-k2-0905-preview", label: "Kimi K2 0905 Preview (strong coding)" },
  ],
  "moonshot-intl": [
    { id: "kimi-k2.5", label: "Kimi K2.5 (latest flagship, recommended)" },
    { id: "kimi-k2-thinking", label: "Kimi K2 Thinking (deep reasoning + tool use)" },
    { id: "kimi-k2-0905-preview", label: "Kimi K2 0905 Preview (strong coding)" },
  ],
  glm: [
    { id: "glm-5", label: "GLM-5 (high reasoning)" },
    { id: "glm-4.7", label: "GLM-4.7 (strong general-purpose)" },
    { id: "glm-4.5-air", label: "GLM-4.5 Air (lower latency)" },
  ],
  "glm-cn": [
    { id: "glm-5", label: "GLM-5 (high reasoning)" },
    { id: "glm-4.7", label: "GLM-4.7 (strong general-purpose)" },
    { id: "glm-4.5-air", label: "GLM-4.5 Air (lower latency)" },
  ],
  zai: [
    { id: "glm-5", label: "GLM-5 (high reasoning)" },
    { id: "glm-4.7", label: "GLM-4.7 (strong general-purpose)" },
    { id: "glm-4.5-air", label: "GLM-4.5 Air (lower latency)" },
  ],
  "zai-cn": [
    { id: "glm-5", label: "GLM-5 (high reasoning)" },
    { id: "glm-4.7", label: "GLM-4.7 (strong general-purpose)" },
    { id: "glm-4.5-air", label: "GLM-4.5 Air (lower latency)" },
  ],
  minimax: [
    { id: "MiniMax-M2.5", label: "MiniMax M2.5 (latest flagship)" },
    { id: "MiniMax-M2.5-highspeed", label: "MiniMax M2.5 High-Speed (fast)" },
    { id: "MiniMax-M2.1", label: "MiniMax M2.1 (strong coding/reasoning)" },
  ],
  "minimax-cn": [
    { id: "MiniMax-M2.5", label: "MiniMax M2.5 (latest flagship)" },
    { id: "MiniMax-M2.5-highspeed", label: "MiniMax M2.5 High-Speed (fast)" },
    { id: "MiniMax-M2.1", label: "MiniMax M2.1 (strong coding/reasoning)" },
  ],
  qwen: [
    { id: "qwen-max", label: "Qwen Max (highest quality)" },
    { id: "qwen-plus", label: "Qwen Plus (balanced default)" },
    { id: "qwen-turbo", label: "Qwen Turbo (fast and cost-efficient)" },
  ],
  "qwen-intl": [
    { id: "qwen-max", label: "Qwen Max (highest quality)" },
    { id: "qwen-plus", label: "Qwen Plus (balanced default)" },
    { id: "qwen-turbo", label: "Qwen Turbo (fast and cost-efficient)" },
  ],
  "qwen-us": [
    { id: "qwen-max", label: "Qwen Max (highest quality)" },
    { id: "qwen-plus", label: "Qwen Plus (balanced default)" },
    { id: "qwen-turbo", label: "Qwen Turbo (fast and cost-efficient)" },
  ],
  "qwen-coding-plan": [
    { id: "qwen3-coder-plus", label: "Qwen3 Coder Plus (recommended for coding)" },
    { id: "qwen3.5-plus", label: "Qwen3.5 Plus (reasoning + coding)" },
    { id: "qwen3-max-2026-01-23", label: "Qwen3 Max (high-capability coding model)" },
  ],
  hunyuan: [
    { id: "hunyuan-t1-latest", label: "Hunyuan T1 (deep reasoning, latest)" },
    { id: "hunyuan-turbo-latest", label: "Hunyuan Turbo (fast, general purpose)" },
    { id: "hunyuan-pro", label: "Hunyuan Pro (high quality)" },
  ],
  bedrock: [
    { id: "anthropic.claude-sonnet-4-6", label: "Claude Sonnet 4.6 (latest, recommended)" },
    { id: "anthropic.claude-opus-4-6-v1", label: "Claude Opus 4.6 (strongest)" },
    {
      id: "anthropic.claude-haiku-4-5-20251001-v1:0",
      label: "Claude Haiku 4.5 (fastest, cheapest)",
    },
    { id: "anthropic.claude-sonnet-4-5-20250929-v1:0", label: "Claude Sonnet 4.5" },
  ],
  nvidia: [
    { id: "meta/llama-3.3-70b-instruct", label: "Llama 3.3 70B Instruct (balanced default)" },
    { id: "deepseek-ai/deepseek-v3.2", label: "DeepSeek V3.2 (advanced reasoning + coding)" },
    { id: "nvidia/llama-3.3-nemotron-super-49b-v1.5", label: "Llama 3.3 Nemotron Super 49B v1.5" },
    { id: "nvidia/llama-3.1-nemotron-ultra-253b-v1", label: "Llama 3.1 Nemotron Ultra 253B v1" },
  ],
  astrai: [
    { id: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6 (balanced default)" },
    { id: "openai/gpt-5.2", label: "GPT-5.2 (latest flagship)" },
    { id: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2 (agentic + affordable)" },
    { id: "z-ai/glm-5", label: "GLM-5 (high reasoning)" },
  ],
  ollama: [
    { id: "llama3.2", label: "Llama 3.2 (recommended local)" },
    { id: "mistral", label: "Mistral 7B" },
    { id: "codellama", label: "Code Llama" },
    { id: "phi3", label: "Phi-3 (small, fast)" },
  ],
  llamacpp: [
    { id: "ggml-org/gpt-oss-20b-GGUF", label: "GPT-OSS 20B GGUF (llama.cpp example)" },
    { id: "bartowski/Llama-3.3-70B-Instruct-GGUF", label: "Llama 3.3 70B GGUF (high quality)" },
    { id: "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF", label: "Qwen2.5 Coder 7B GGUF (coding-focused)" },
  ],
  sglang: [
    { id: "meta-llama/Llama-3.1-8B-Instruct", label: "Llama 3.1 8B Instruct (popular, fast)" },
    { id: "meta-llama/Llama-3.1-70B-Instruct", label: "Llama 3.1 70B Instruct (high quality)" },
    { id: "Qwen/Qwen2.5-Coder-7B-Instruct", label: "Qwen2.5 Coder 7B Instruct (coding-focused)" },
  ],
  vllm: [
    { id: "meta-llama/Llama-3.1-8B-Instruct", label: "Llama 3.1 8B Instruct (popular, fast)" },
    { id: "meta-llama/Llama-3.1-70B-Instruct", label: "Llama 3.1 70B Instruct (high quality)" },
    { id: "Qwen/Qwen2.5-Coder-7B-Instruct", label: "Qwen2.5 Coder 7B Instruct (coding-focused)" },
  ],
  osaurus: [
    { id: "qwen3-30b-a3b-8bit", label: "Qwen3 30B A3B (local, balanced)" },
    { id: "gemma-3n-e4b-it-lm-4bit", label: "Gemma 3N E4B (local, efficient)" },
    { id: "phi-4-mini-reasoning-mlx-4bit", label: "Phi-4 Mini Reasoning (local, fast reasoning)" },
  ],
};

export function getCuratedModels(provider: string): CuratedModel[] {
  return CURATED_MODELS[provider] ?? [];
}

// --- Model fetch endpoints ---

export function getModelsFetchEndpoint(
  provider: string,
  apiUrl?: string,
): { url: string; authHeader: (key: string) => Record<string, string> } | null {
  const bearerAuth = (key: string): Record<string, string> => ({
    Authorization: `Bearer ${key}`,
  });

  const openaiCompatible: Record<string, string> = {
    openai: "https://api.openai.com/v1/models",
    openrouter: "https://openrouter.ai/api/v1/models",
    groq: "https://api.groq.com/openai/v1/models",
    mistral: "https://api.mistral.ai/v1/models",
    deepseek: "https://api.deepseek.com/v1/models",
    xai: "https://api.x.ai/v1/models",
    "together-ai": "https://api.together.xyz/v1/models",
    fireworks: "https://api.fireworks.ai/inference/v1/models",
    venice: "https://api.venice.ai/api/v1/models",
    novita: "https://api.novita.ai/openai/v1/models",
    perplexity: "https://api.perplexity.ai/models",
    cohere: "https://api.cohere.com/compatibility/v1/models",
    moonshot: "https://api.moonshot.cn/v1/models",
    "moonshot-intl": "https://api.moonshot.ai/v1/models",
    "kimi-code": "https://api.kimi.com/coding/v1/models",
    nvidia: "https://integrate.api.nvidia.com/v1/models",
    vercel: "https://ai-gateway.vercel.sh/v1/models",
    astrai: "https://as-trai.com/v1/models",
    glm: "https://api.z.ai/api/paas/v4/models",
    "glm-cn": "https://open.bigmodel.cn/api/paas/v4/models",
    minimax: "https://api.minimax.io/v1/models",
    "minimax-cn": "https://api.minimaxi.com/v1/models",
    qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
    "qwen-intl": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models",
    "qwen-us": "https://dashscope-us.aliyuncs.com/compatible-mode/v1/models",
    "qwen-coding-plan": "https://coding.dashscope.aliyuncs.com/v1/models",
    hunyuan: "https://api.hunyuan.cloud.tencent.com/v1/models",
    zai: "https://api.z.ai/api/coding/paas/v4/models",
    "zai-cn": "https://open.bigmodel.cn/api/coding/paas/v4/models",
  };

  if (openaiCompatible[provider]) {
    return { url: openaiCompatible[provider], authHeader: bearerAuth };
  }

  if (provider === "anthropic") {
    return {
      url: "https://api.anthropic.com/v1/models",
      authHeader: (key) => ({
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      }),
    };
  }

  if (provider === "gemini") {
    return {
      url: "https://generativelanguage.googleapis.com/v1beta/models",
      authHeader: () => ({}),
    };
  }

  if (provider === "ollama") {
    const base = apiUrl ?? "http://127.0.0.1:11434";
    return { url: `${base}/api/tags`, authHeader: () => ({}) };
  }

  const localDefaults: Record<string, string> = {
    lmstudio: "http://localhost:1234/v1/models",
    llamacpp: "http://localhost:8080/v1/models",
    sglang: "http://localhost:30000/v1/models",
    vllm: "http://localhost:8000/v1/models",
    osaurus: "http://localhost:1337/v1/models",
  };
  if (localDefaults[provider]) {
    const url = apiUrl ? `${apiUrl.replace(/\/+$/, "")}/v1/models` : localDefaults[provider];
    return { url, authHeader: () => ({}) };
  }

  if (apiUrl) {
    const base = apiUrl.replace(/\/+$/, "");
    return { url: `${base}/v1/models`, authHeader: bearerAuth };
  }

  return null;
}

// --- Channels ---

export const CHANNELS: ChannelInfo[] = [
  {
    id: "telegram",
    name: "Telegram",
    setupFields: [
      { name: "bot_token", label: "Bot token (from @BotFather)", type: "password", required: true },
      {
        name: "allowed_users",
        label: "Allowed Telegram identities (comma-separated, * for all)",
        type: "list",
        required: true,
        description: "username (no @) or numeric user ID",
        guidance: [
          "Allowlist your own Telegram identity first (recommended for secure setup).",
          "Use your @username without '@' (e.g. johndoe), or your numeric Telegram user ID.",
          "Use '*' only for temporary open testing.",
        ],
      },
    ],
  },
  {
    id: "discord",
    name: "Discord",
    setupFields: [
      {
        name: "bot_token",
        label: "Bot token (from Discord Developer Portal)",
        type: "password",
        required: true,
      },
      {
        name: "guild_id",
        label: "Guild (server) ID",
        type: "text",
        required: false,
        description: "Restrict to one server, or leave empty for all",
      },
      {
        name: "allowed_users",
        label: "Allowed Discord user IDs (comma-separated, * for all)",
        type: "list",
        required: true,
        description: "recommended: your own user ID",
        guidance: [
          "Allowlist your own Discord user ID first (recommended).",
          "Get it in Discord: Settings \u2192 Advanced \u2192 Developer Mode (ON), then right-click your profile \u2192 Copy User ID.",
          "Use '*' only for temporary open testing.",
        ],
      },
    ],
  },
  {
    id: "slack",
    name: "Slack",
    setupFields: [
      { name: "bot_token", label: "Bot token (xoxb-...)", type: "password", required: true },
      {
        name: "signing_secret",
        label: "Signing secret (from App Credentials)",
        type: "password",
        required: false,
        description: "Required for webhook wake — verifies incoming Events API requests",
      },
      {
        name: "app_token",
        label: "App-level token (xapp-...)",
        type: "password",
        required: false,
        description: "Enables Socket Mode (real-time)",
      },
      {
        name: "channel_id",
        label: "Default channel ID",
        type: "text",
        required: false,
        description: "Restrict to one channel, or leave empty for all",
      },
      {
        name: "allowed_users",
        label: "Allowed Slack user IDs (comma-separated, * for all)",
        type: "list",
        required: true,
        description: "recommended: your own member ID",
        guidance: [
          "Allowlist your own Slack member ID first (recommended).",
          "Member IDs start with 'U' \u2014 open your Slack profile \u2192 More \u2192 Copy member ID.",
          "Use '*' only for temporary open testing.",
        ],
      },
    ],
  },
  {
    id: "imessage",
    name: "iMessage",
    setupFields: [
      {
        name: "allowed_contacts",
        label: "Allowed contacts (comma-separated phone/email, * for all)",
        type: "list",
        required: false,
        default: "*",
        description: "macOS only — uses Messages.app",
      },
    ],
  },
  {
    id: "matrix",
    name: "Matrix",
    setupFields: [
      {
        name: "homeserver",
        label: "Homeserver URL (e.g. https://matrix.org)",
        type: "text",
        required: true,
      },
      { name: "access_token", label: "Access token", type: "password", required: true },
      { name: "room_id", label: "Room ID (e.g. !abc123:matrix.org)", type: "text", required: true },
      {
        name: "allowed_users",
        label: "Allowed users (comma-separated @user:server, * for all)",
        type: "list",
        required: false,
        default: "*",
      },
    ],
  },
  {
    id: "signal",
    name: "Signal",
    setupFields: [
      {
        name: "http_url",
        label: "signal-cli HTTP URL",
        type: "text",
        required: false,
        default: "http://127.0.0.1:8686",
      },
      {
        name: "account",
        label: "Account number (E.164, e.g. +1234567890)",
        type: "text",
        required: true,
      },
      {
        name: "group_id",
        label: "Group ID (leave empty for all messages, 'dm' for DM only)",
        type: "text",
        required: false,
      },
      {
        name: "allowed_from",
        label: "Allowed sender numbers (comma-separated, * for all)",
        type: "list",
        required: false,
        default: "*",
      },
    ],
  },
  {
    id: "whatsapp",
    name: "WhatsApp (Cloud API)",
    setupFields: [
      {
        name: "access_token",
        label: "Access token (from Meta Developers)",
        type: "password",
        required: true,
      },
      {
        name: "phone_number_id",
        label: "Phone number ID (from WhatsApp app settings)",
        type: "text",
        required: true,
      },
      {
        name: "app_secret",
        label: "App secret (for webhook signature verification)",
        type: "password",
        required: false,
        description:
          "Required for webhook wake — found in Meta App Dashboard → App Settings → Basic",
      },
      {
        name: "verify_token",
        label: "Webhook verify token",
        type: "text",
        required: false,
        default: "zeroclaw-whatsapp-verify",
      },
      {
        name: "allowed_numbers",
        label: "Allowed phone numbers (comma-separated, * for all)",
        type: "list",
        required: false,
        default: "*",
      },
    ],
  },
  {
    id: "linq",
    name: "Linq",
    setupFields: [
      {
        name: "api_token",
        label: "API token (Linq Partner API)",
        type: "password",
        required: true,
      },
      {
        name: "from_phone",
        label: "From phone number (E.164, e.g. +12223334444)",
        type: "text",
        required: true,
      },
      {
        name: "signing_secret",
        label: "Webhook signing secret",
        type: "password",
        required: false,
      },
      {
        name: "allowed_senders",
        label: "Allowed sender numbers (comma-separated, * for all)",
        type: "list",
        required: false,
        default: "*",
      },
    ],
  },
  {
    id: "irc",
    name: "IRC",
    setupFields: [
      { name: "server", label: "IRC server (hostname)", type: "text", required: true },
      { name: "port", label: "Port", type: "text", required: false, default: "6697" },
      { name: "nickname", label: "Bot nickname", type: "text", required: true },
      {
        name: "channels",
        label: "Channels to join (comma-separated, e.g. #channel1,#channel2)",
        type: "list",
        required: false,
      },
      {
        name: "allowed_users",
        label: "Allowed nicknames (comma-separated, * for all)",
        type: "list",
        required: true,
        description: "case-insensitive",
      },
      {
        name: "server_password",
        label: "Server password (for bouncers like ZNC)",
        type: "password",
        required: false,
      },
      { name: "nickserv_password", label: "NickServ password", type: "password", required: false },
      { name: "sasl_password", label: "SASL PLAIN password", type: "password", required: false },
    ],
  },
  {
    id: "webhook",
    name: "Webhook",
    setupFields: [
      { name: "port", label: "Port", type: "text", required: false, default: "8080" },
      {
        name: "secret",
        label: "Secret (for signature verification)",
        type: "password",
        required: false,
      },
    ],
  },
  {
    id: "nextcloud_talk",
    name: "Nextcloud Talk",
    setupFields: [
      {
        name: "base_url",
        label: "Nextcloud base URL (e.g. https://cloud.example.com)",
        type: "text",
        required: true,
      },
      { name: "app_token", label: "App token (Talk bot token)", type: "password", required: true },
      { name: "webhook_secret", label: "Webhook secret", type: "password", required: false },
      {
        name: "allowed_users",
        label: "Allowed actor IDs (comma-separated, * for all)",
        type: "list",
        required: false,
        default: "*",
      },
    ],
  },
  {
    id: "dingtalk",
    name: "DingTalk",
    setupFields: [
      { name: "client_id", label: "Client ID (AppKey)", type: "text", required: true },
      {
        name: "client_secret",
        label: "Client Secret (AppSecret)",
        type: "password",
        required: true,
      },
      {
        name: "allowed_users",
        label: "Allowed staff IDs (comma-separated, * for all)",
        type: "list",
        required: true,
      },
    ],
  },
  {
    id: "qq",
    name: "QQ Official",
    setupFields: [
      { name: "app_id", label: "App ID", type: "text", required: true },
      { name: "app_secret", label: "App Secret", type: "password", required: true },
      {
        name: "allowed_users",
        label: "Allowed user IDs (comma-separated, * for all)",
        type: "list",
        required: true,
      },
      {
        name: "receive_mode",
        label: "Receive mode",
        type: "text",
        required: false,
        default: "webhook",
        description: "webhook or websocket",
      },
      {
        name: "environment",
        label: "API environment",
        type: "text",
        required: false,
        default: "production",
        description: "production or sandbox",
      },
    ],
  },
  {
    id: "lark",
    name: "Lark / Feishu",
    setupFields: [
      { name: "app_id", label: "App ID", type: "text", required: true },
      { name: "app_secret", label: "App Secret", type: "password", required: true },
      {
        name: "use_feishu",
        label: "Region",
        type: "text",
        required: false,
        default: "false",
        description: "false = Lark (international), true = Feishu (China)",
      },
      {
        name: "receive_mode",
        label: "Receive mode",
        type: "text",
        required: false,
        default: "websocket",
        description: "websocket or webhook",
      },
      {
        name: "verification_token",
        label: "Verification token (for webhook mode)",
        type: "password",
        required: false,
      },
      {
        name: "allowed_users",
        label: "Allowed user Open IDs (comma-separated, * for all)",
        type: "list",
        required: true,
      },
    ],
  },
  {
    id: "nostr",
    name: "Nostr",
    setupFields: [
      {
        name: "private_key",
        label: "Private key (hex or nsec1...)",
        type: "password",
        required: true,
      },
      {
        name: "relays",
        label: "Relay URLs (comma-separated)",
        type: "list",
        required: false,
        default:
          "wss://relay.damus.io, wss://nos.lol, wss://relay.primal.net, wss://relay.snort.social",
      },
      {
        name: "allowed_pubkeys",
        label: "Allowed pubkeys (comma-separated, * for all)",
        type: "list",
        required: true,
        description: "hex or npub",
      },
    ],
  },
];

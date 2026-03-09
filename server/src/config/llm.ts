import type { ModelId } from "./models.js";

interface LlmDefaults {
  modelId: ModelId;
  openaiApiKey: string;
  openaiBaseURL: string;
}

type LlmConfig = LlmDefaults;

// 兜底值，仅在本地配置和环境变量都未提供时使用。
const DEFAULT_LLM_CONFIG: LlmDefaults = {
  modelId: "openai:gpt-4o-mini",
  openaiApiKey: "",
  openaiBaseURL: "",
};

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();

  return value ? value : undefined;
}

// 默认走环境变量，避免把敏感凭据写入源码或仓库历史。
const CONFIG_SOURCE: "local" | "env" = readEnv("LLM_CONFIG_SOURCE") === "local" ? "local" : "env";

const LOCAL_LLM_CONFIG: LlmConfig = {
  modelId: "deepseek-reasoner",
  openaiApiKey: "",
  openaiBaseURL: "https://api.deepseek.com",
};

const ENV_LLM_CONFIG: LlmConfig = {
  modelId: readEnv("DEFAULT_MODEL_ID") ?? DEFAULT_LLM_CONFIG.modelId,
  openaiApiKey: readEnv("OPENAI_API_KEY") ?? DEFAULT_LLM_CONFIG.openaiApiKey,
  openaiBaseURL: readEnv("OPENAI_BASE_URL") ?? DEFAULT_LLM_CONFIG.openaiBaseURL,
};

export const LLM_CONFIG: LlmConfig = CONFIG_SOURCE === "local" ? LOCAL_LLM_CONFIG : ENV_LLM_CONFIG;

export function getDefaultModelId(): ModelId {
  return LLM_CONFIG.modelId;
}

export function getOpenAIConfig(overrides?: {
  openaiApiKey?: string;
  openaiBaseURL?: string;
}): {
  apiKey?: string;
  baseURL?: string;
} {
  const apiKey = overrides?.openaiApiKey?.trim() || LLM_CONFIG.openaiApiKey || undefined;
  const baseURL = overrides?.openaiBaseURL?.trim() || LLM_CONFIG.openaiBaseURL || undefined;

  return {
    apiKey,
    baseURL,
  };
}

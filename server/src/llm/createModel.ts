import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { getOpenAIConfig } from "../config/llm.js";
import { BUILTIN_MODELS, type ModelOption } from "../config/models.js";

export interface ProviderOverrides {
  openaiApiKey?: string;
  openaiBaseURL?: string;
}

export function getModelOptionById(modelId: string): ModelOption {
  const option = BUILTIN_MODELS.find((m) => m.id === modelId);

  if (!option) {
    throw new Error(`Unknown model: ${modelId}`);
  }

  return option;
}

export function isDeepSeekReasoningModel(modelId: string): boolean {
  return getModelOptionById(modelId).reasoningMode === "deepseek";
}

export function getModelById(modelId: string, overrides?: ProviderOverrides): BaseChatModel {
  const option = getModelOptionById(modelId);

  const { apiKey, baseURL } = getOpenAIConfig(overrides);

  return new ChatOpenAI({
    model: option.model,
    __includeRawResponse: true,
    ...(option.reasoningMode !== "deepseek" ? { temperature: 0.7 } : {}),
    ...(apiKey && { apiKey }),
    ...(baseURL && { configuration: { basePath: baseURL } }),
  });
}

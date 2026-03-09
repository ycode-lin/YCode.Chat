export type ModelId = string;

export interface ModelOption {
  id: ModelId;
  name: string;
  provider: "openai";
  model: string;
  supportsReasoning?: boolean;
  reasoningMode?: "deepseek";
}

export const BUILTIN_MODELS: ModelOption[] = [
  { id: "deepseek-chat", name: "DeepSeek Chat", provider: "openai", model: "deepseek-chat" },
  {
    id: "deepseek-reasoner",
    name: "DeepSeek Reasoner",
    provider: "openai",
    model: "deepseek-reasoner",
    supportsReasoning: true,
    reasoningMode: "deepseek",
  },
  { id: "openai:gpt-4o-mini", name: "GPT-4o Mini", provider: "openai", model: "gpt-4o-mini" },
  { id: "openai:gpt-4o", name: "GPT-4o", provider: "openai", model: "gpt-4o" },
];

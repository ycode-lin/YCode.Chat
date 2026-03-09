import type { PromptTemplate } from "../config/prompts.js";
import type { ProviderOverrides } from "./createModel.js";
import { resumePendingRunStream, runAgentStream } from "./runAgentStream.js";
import type { ChatStreamEvent } from "./chatEvents.js";
import type { McpToolBinding } from "../mcp/loadTools.js";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatRequest {
  sessionId: string;
  messages: ChatMessage[];
  modelId: string;
  systemPrompt?: string;
  promptId?: string;
  promptTemplates?: PromptTemplate[];
  tools?: McpToolBinding[];
  providerOverrides?: ProviderOverrides;
}

export async function runChat(request: ChatRequest): Promise<string> {
  let content = "";

  for await (const event of runAgentStream(request)) {
    if (event.event === "text_delta") {
      content += event.data.delta;
    }

    if (event.event === "error") {
      throw new Error(event.data.message);
    }
  }

  return content;
}

export async function* streamChat(request: ChatRequest): AsyncGenerator<string> {
  for await (const event of runAgentStream(request)) {
    if (event.event === "text_delta") {
      yield event.data.delta;
    }
  }
}

export async function* streamChatEvents(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
  yield* runAgentStream(request);
}

export async function* resumeChatEvents(runId: string): AsyncGenerator<ChatStreamEvent> {
  yield* resumePendingRunStream(runId);
}

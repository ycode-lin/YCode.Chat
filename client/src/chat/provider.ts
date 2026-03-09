import { AbstractChatProvider, type TransformMessage, type XRequestOptions } from "@ant-design/x-sdk";
import { createChatRequest } from "./request";
import type { ChatAgentMessage, ChatRequestInput, ChatSseChunk, ChatSseEvent, ChatTurn, ToolCallState } from "./types";

function createAssistantMessage(): ChatAgentMessage {
  return {
    role: "assistant",
    content: "",
    timestamp: Date.now(),
    toolCalls: [],
    meta: {},
  };
}

function toServerMessage(message: ChatAgentMessage): ChatTurn {
  return {
    role: message.role,
    content: message.content,
  };
}

export function parseChatSseEvent(chunk: ChatSseChunk | undefined): ChatSseEvent | null {
  if (!chunk?.event || !chunk.data) return null;
  try {
    return {
      event: chunk.event,
      data: JSON.parse(chunk.data),
    } as ChatSseEvent;
  } catch {
    return null;
  }
}

function cloneToolCalls(toolCalls: ToolCallState[]): ToolCallState[] {
  return toolCalls.map((tool) => ({ ...tool }));
}

function upsertToolCall(toolCalls: ToolCallState[], nextTool: ToolCallState): ToolCallState[] {
  const next = cloneToolCalls(toolCalls);
  const index = next.findIndex((tool) => tool.id === nextTool.id);
  if (index >= 0) {
    next[index] = {
      ...next[index],
      ...nextTool,
    };
    return next;
  }
  return [...next, nextTool];
}

function getExistingTool(toolCalls: ToolCallState[], toolCallId: string): ToolCallState | undefined {
  return toolCalls.find((tool) => tool.id === toolCallId);
}

export function applyChatEventToMessage(current: ChatAgentMessage, event: ChatSseEvent): ChatAgentMessage {
  switch (event.event) {
    case "message_start":
      return {
        ...current,
        timestamp: Date.parse(event.data.timestamp) || current.timestamp,
        meta: {
          ...current.meta,
          sessionId: event.data.sessionId,
          runId: event.data.runId,
          messageId: event.data.messageId,
        },
      };
    case "text_delta":
      return {
        ...current,
        content: `${current.content}${event.data.delta}`,
      };
    case "reasoning_delta":
      return {
        ...current,
        meta: {
          ...current.meta,
          reasoningContent: `${current.meta?.reasoningContent ?? ""}${event.data.delta}`,
        },
      };
    case "tool_approval_required":
      return {
        ...current,
        toolCalls: upsertToolCall(current.toolCalls, {
          id: event.data.toolCallId,
          name: event.data.toolName,
          serverName: event.data.serverName,
          approvalMode: event.data.approvalMode,
          approvalState: "required",
          status: "awaiting_approval",
          input: event.data.input,
          approvalRequestedAt: event.data.timestamp,
        }),
      };
    case "tool_approval_resolved": {
      const existing = getExistingTool(current.toolCalls, event.data.toolCallId);
      return {
        ...current,
        toolCalls: upsertToolCall(current.toolCalls, {
          id: event.data.toolCallId,
          name: event.data.toolName,
          serverName: event.data.serverName,
          approvalMode: existing?.approvalMode,
          approvalState: event.data.decision === "deny" ? "denied" : "approved",
          approvalDecision: event.data.decision,
          approvalRequestedAt: existing?.approvalRequestedAt,
          approvalResolvedAt: event.data.timestamp,
          status: event.data.decision === "deny" ? "denied" : "pending",
          input: existing?.input,
        }),
      };
    }
    case "tool_start": {
      const existing = getExistingTool(current.toolCalls, event.data.toolCallId);
      return {
        ...current,
        toolCalls: upsertToolCall(current.toolCalls, {
          id: event.data.toolCallId,
          name: event.data.toolName,
          serverName: event.data.serverName,
          approvalMode: existing?.approvalMode,
          approvalState: existing?.approvalState,
          approvalDecision: existing?.approvalDecision,
          approvalRequestedAt: existing?.approvalRequestedAt,
          approvalResolvedAt: existing?.approvalResolvedAt,
          status: "running",
          input: event.data.input,
          startedAt: event.data.timestamp,
        }),
      };
    }
    case "tool_result": {
      const existing = getExistingTool(current.toolCalls, event.data.toolCallId);
      return {
        ...current,
        toolCalls: upsertToolCall(current.toolCalls, {
          id: event.data.toolCallId,
          name: event.data.toolName,
          serverName: event.data.serverName,
          approvalMode: existing?.approvalMode,
          approvalState: event.data.status === "denied" ? "denied" : existing?.approvalState,
          approvalDecision: event.data.status === "denied" ? "deny" : existing?.approvalDecision,
          approvalRequestedAt: existing?.approvalRequestedAt,
          approvalResolvedAt: existing?.approvalResolvedAt,
          status: event.data.status,
          input: existing?.input,
          output: event.data.output,
          display: event.data.display,
          startedAt: existing?.startedAt,
          finishedAt: event.data.timestamp,
        }),
      };
    }
    case "message_end":
      return {
        ...current,
        meta: {
          ...current.meta,
          finishReason: event.data.finishReason,
          usage: event.data.usage,
        },
      };
    case "error":
      return {
        ...current,
        meta: {
          ...current.meta,
          error: event.data.message,
          finishReason: "error",
        },
      };
    default:
      return current;
  }
}

function finalizeFromChunks(message: ChatAgentMessage, chunks: ChatSseChunk[]): ChatAgentMessage {
  return chunks.reduce((current, chunk) => {
    const event = parseChatSseEvent(chunk);
    if (!event) return current;
    return applyChatEventToMessage(current, event);
  }, message);
}

export class ChatAgentProvider extends AbstractChatProvider<ChatAgentMessage, ChatRequestInput, ChatSseChunk> {
  transformParams(
    requestParams: Partial<ChatRequestInput>,
    options: XRequestOptions<ChatRequestInput, ChatSseChunk, ChatAgentMessage>
  ): ChatRequestInput {
    return {
      query: requestParams.query?.trim() ?? "",
      sessionId: requestParams.sessionId ?? "",
      modelId: requestParams.modelId ?? "",
      systemPrompt: requestParams.systemPrompt ?? "",
      stream: true,
      messages: this.getMessages().map(toServerMessage),
      ...(options.params ?? {}),
    };
  }

  transformLocalMessage(requestParams: Partial<ChatRequestInput>): ChatAgentMessage {
    return {
      role: "user",
      content: requestParams.query?.trim() ?? "",
      timestamp: Date.now(),
      toolCalls: [],
    };
  }

  transformMessage(info: TransformMessage<ChatAgentMessage, ChatSseChunk>): ChatAgentMessage {
    if (!info.chunk) {
      return finalizeFromChunks(info.originMessage ?? createAssistantMessage(), info.chunks);
    }

    const event = parseChatSseEvent(info.chunk);
    const current = info.originMessage ?? createAssistantMessage();

    if (!event) {
      return current;
    }
    return applyChatEventToMessage(current, event);
  }
}

export function createChatProvider() {
  return new ChatAgentProvider({
    request: createChatRequest(),
  });
}

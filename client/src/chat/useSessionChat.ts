import { useXChat } from "@ant-design/x-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchPendingRuns, submitToolApprovalDecision, type PendingRunDecision } from "../api";
import { applyChatEventToMessage, createChatProvider, parseChatSseEvent } from "./provider";
import { getTraceMessageById, mapMessageInfoToBubbleItems } from "./messageMapper";
import { streamPendingRunResume } from "./request";
import type { ChatAgentMessage, ChatRequestInput, ChatRuntimeContext, ChatSseChunk, ToolCallState } from "./types";

function createAssistantPlaceholder(): ChatAgentMessage {
  return {
    role: "assistant",
    content: "",
    timestamp: Date.now(),
    toolCalls: [],
    meta: {},
  };
}

interface UseSessionChatOptions {
  activeSessionId: string;
  sessionMessages: ChatAgentMessage[];
  runtimeContext: ChatRuntimeContext;
  onPersistMessages: (sessionId: string, messages: ChatAgentMessage[]) => void;
}

export function useSessionChat({
  activeSessionId,
  sessionMessages,
  runtimeContext,
  onPersistMessages,
}: UseSessionChatOptions) {
  const provider = useMemo(() => createChatProvider(), []);
  const [selectedTraceMessageId, setSelectedTraceMessageId] = useState<string | number | null>(null);
  const [activeApprovalKeys, setActiveApprovalKeys] = useState<string[]>([]);

  const {
    messages,
    onRequest,
    isRequesting,
    abort,
    isDefaultMessagesRequesting,
    setMessages,
  } = useXChat<ChatAgentMessage, ChatAgentMessage, ChatRequestInput, ChatSseChunk>({
    provider,
    conversationKey: activeSessionId,
    defaultMessages: async () => sessionMessages.map((message) => ({ message, status: "success" as const })),
    requestPlaceholder: () => createAssistantPlaceholder(),
    requestFallback: (_, { error, messageInfo }) => {
      const previous =
        typeof messageInfo?.message === "object" && messageInfo?.message !== null
          ? (messageInfo.message as ChatAgentMessage)
          : createAssistantPlaceholder();

      return {
        ...previous,
        meta: {
          ...previous.meta,
          error: error.message,
          finishReason: error.name === "AbortError" ? "abort" : "error",
        },
      };
    },
  });

  const updateRunMessage = useCallback(
    (runId: string, updater: (message: ChatAgentMessage) => ChatAgentMessage, status: "updating" | "success" | "error") => {
      setMessages((origin) =>
        origin.map((info) =>
          info.message.meta?.runId === runId
            ? {
                ...info,
                message: updater(info.message),
                status,
              }
            : info
        )
      );
    },
    [setMessages]
  );

  const syncPendingRuns = useCallback(async () => {
    const runs = await fetchPendingRuns(activeSessionId);
    if (!runs.length) return;

    const runsById = new Map(runs.map((run) => [run.runId, run] as const));
    setMessages((origin) =>
      origin.map((info) => {
        const runId = info.message.meta?.runId;
        if (!runId) return info;

        const pendingRun = runsById.get(runId);
        if (!pendingRun) return info;

        let nextMessage = applyChatEventToMessage(info.message, {
          event: "tool_approval_required",
          data: {
            runId: pendingRun.runId,
            messageId: pendingRun.messageId,
            toolCallId: pendingRun.pendingTool.toolCallId,
            toolName: pendingRun.pendingTool.toolName,
            serverName: pendingRun.pendingTool.serverName,
            input: pendingRun.pendingTool.input,
            approvalMode: pendingRun.pendingTool.approvalMode,
            timestamp: pendingRun.pendingTool.requestedAt,
          },
        });

        if (pendingRun.pendingTool.decision && pendingRun.pendingTool.decidedAt) {
          nextMessage = applyChatEventToMessage(nextMessage, {
            event: "tool_approval_resolved",
            data: {
              runId: pendingRun.runId,
              messageId: pendingRun.messageId,
              toolCallId: pendingRun.pendingTool.toolCallId,
              toolName: pendingRun.pendingTool.toolName,
              serverName: pendingRun.pendingTool.serverName,
              decision: pendingRun.pendingTool.decision,
              timestamp: pendingRun.pendingTool.decidedAt,
            },
          });
        }

        return {
          ...info,
          message: nextMessage,
          status: pendingRun.pendingTool.decision ? "updating" : info.status,
        };
      })
    );
  }, [activeSessionId, setMessages]);

  useEffect(() => {
    if (isDefaultMessagesRequesting) return;
    void syncPendingRuns().catch(() => {});
  }, [isDefaultMessagesRequesting, syncPendingRuns]);

  useEffect(() => {
    if (isDefaultMessagesRequesting) return;
    onPersistMessages(
      activeSessionId,
      messages.map((info) => info.message)
    );
  }, [activeSessionId, isDefaultMessagesRequesting, messages, onPersistMessages]);

  useEffect(() => {
    if (selectedTraceMessageId === null) return;
    if (!messages.some((info) => info.id === selectedTraceMessageId)) {
      setSelectedTraceMessageId(null);
    }
  }, [messages, selectedTraceMessageId]);

  const bubbleItems = useMemo(() => mapMessageInfoToBubbleItems(messages), [messages]);
  const traceMessage = useMemo(
    () => getTraceMessageById(messages, selectedTraceMessageId)?.message ?? null,
    [messages, selectedTraceMessageId]
  );

  const resumePendingRun = useCallback(
    async (runId: string) => {
      updateRunMessage(runId, (message) => message, "updating");

      for await (const chunk of streamPendingRunResume(runId)) {
        const event = parseChatSseEvent(chunk);

        if (!event) continue;

        updateRunMessage(
          runId,
          (message) => applyChatEventToMessage(message, event),
          event.event === "message_end" ? (event.data.finishReason === "error" ? "error" : "success") : event.event === "error" ? "error" : "updating"
        );
      }
    },
    [updateRunMessage]
  );

  const resolveToolApproval = useCallback(
    async (message: ChatAgentMessage, tool: ToolCallState, decision: PendingRunDecision) => {
      const runId = message.meta?.runId;
      if (!runId) {
        throw new Error("当前消息缺少 runId，无法继续审批");
      }

      const actionKey = `${runId}:${tool.id}`;
      setActiveApprovalKeys((current) => [...current, actionKey]);

      try {
        await submitToolApprovalDecision(runId, tool.id, decision);
        await resumePendingRun(runId);
      } catch (error) {
        updateRunMessage(runId, (currentMessage) => ({
          ...currentMessage,
          meta: {
            ...currentMessage.meta,
            error: error instanceof Error ? error.message : "审批处理失败",
            finishReason: "error",
          },
        }), "error");
        throw error;
      } finally {
        setActiveApprovalKeys((current) => current.filter((key) => key !== actionKey));
      }
    },
    [resumePendingRun, updateRunMessage]
  );

  const send = (query: string) => {
    onRequest({
      query,
      sessionId: activeSessionId,
      modelId: runtimeContext.modelId,
      systemPrompt: runtimeContext.systemPrompt,
    });
  };

  return {
    messages,
    bubbleItems,
    traceMessage,
    isRequesting: isRequesting || activeApprovalKeys.length > 0,
    abort,
    send,
    resolveToolApproval,
    isToolApprovalLoading: (message: ChatAgentMessage, tool: ToolCallState) =>
      Boolean(message.meta?.runId && activeApprovalKeys.includes(`${message.meta.runId}:${tool.id}`)),
    inspectTraceMessage: setSelectedTraceMessageId,
  };
}

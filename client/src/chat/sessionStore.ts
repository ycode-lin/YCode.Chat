import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatAgentMessage, ChatSession, ToolCallState } from "./types";

const SESSION_STORAGE_KEY = "chat-agent-sessions-v2";
const ACTIVE_SESSION_STORAGE_KEY = "chat-agent-active-session-v2";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeToolCall(value: unknown): ToolCallState | null {
  if (!isObject(value) || typeof value.id !== "string" || typeof value.name !== "string") {
    return null;
  }

  const status =
    value.status === "pending" ||
    value.status === "awaiting_approval" ||
    value.status === "running" ||
    value.status === "success" ||
    value.status === "error" ||
    value.status === "denied"
      ? value.status
      : "pending";

  return {
    id: value.id,
    name: value.name,
    status,
    serverName: typeof value.serverName === "string" ? value.serverName : undefined,
    bindingName: typeof value.bindingName === "string" ? value.bindingName : undefined,
    approvalMode: value.approvalMode === "manual" || value.approvalMode === "solo" ? value.approvalMode : undefined,
    approvalState:
      value.approvalState === "required" || value.approvalState === "approved" || value.approvalState === "denied"
        ? value.approvalState
        : undefined,
    approvalDecision: value.approvalDecision === "approve" || value.approvalDecision === "deny" ? value.approvalDecision : undefined,
    input: value.input,
    output: value.output,
    display: typeof value.display === "string" ? value.display : undefined,
    approvalRequestedAt: typeof value.approvalRequestedAt === "string" ? value.approvalRequestedAt : undefined,
    approvalResolvedAt: typeof value.approvalResolvedAt === "string" ? value.approvalResolvedAt : undefined,
    startedAt: typeof value.startedAt === "string" ? value.startedAt : undefined,
    finishedAt: typeof value.finishedAt === "string" ? value.finishedAt : undefined,
  };
}

function isToolCallState(value: ReturnType<typeof sanitizeToolCall>): value is NonNullable<ReturnType<typeof sanitizeToolCall>> {
  return value !== null;
}

function sanitizeMessage(value: unknown): ChatAgentMessage | null {
  if (!isObject(value)) return null;
  if (
    (value.role !== "user" && value.role !== "assistant" && value.role !== "system") ||
    typeof value.content !== "string" ||
    typeof value.timestamp !== "number"
  ) {
    return null;
  }

  return {
    role: value.role,
    content: value.content,
    timestamp: value.timestamp,
    toolCalls: Array.isArray(value.toolCalls) ? value.toolCalls.map(sanitizeToolCall).filter(isToolCallState) : [],
    meta: isObject(value.meta)
      ? {
          sessionId: typeof value.meta.sessionId === "string" ? value.meta.sessionId : undefined,
          runId: typeof value.meta.runId === "string" ? value.meta.runId : undefined,
          messageId: typeof value.meta.messageId === "string" ? value.meta.messageId : undefined,
          finishReason: typeof value.meta.finishReason === "string" ? value.meta.finishReason : undefined,
          error: typeof value.meta.error === "string" || value.meta.error === null ? value.meta.error : undefined,
          reasoningContent: typeof value.meta.reasoningContent === "string" ? value.meta.reasoningContent : undefined,
          usage: isObject(value.meta.usage)
            ? {
                inputTokens: typeof value.meta.usage.inputTokens === "number" ? value.meta.usage.inputTokens : undefined,
                outputTokens: typeof value.meta.usage.outputTokens === "number" ? value.meta.usage.outputTokens : undefined,
                totalTokens: typeof value.meta.usage.totalTokens === "number" ? value.meta.usage.totalTokens : undefined,
                raw: value.meta.usage.raw,
              }
            : undefined,
        }
      : undefined,
  };
}

function isChatAgentMessage(value: ChatAgentMessage | null): value is ChatAgentMessage {
  return value !== null;
}

function isChatSession(value: ChatSession | null): value is ChatSession {
  return value !== null;
}

function deriveTitle(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "新会话";
  return compact.length > 20 ? `${compact.slice(0, 20)}...` : compact;
}

function getSessionTitle(session: ChatSession, messages: ChatAgentMessage[]): string {
  if (session.title !== "新会话") return session.title;
  const firstUserMessage = messages.find((message) => message.role === "user" && message.content.trim());
  return firstUserMessage ? deriveTitle(firstUserMessage.content) : session.title;
}

function sanitizeSessions(raw: string | null): ChatSession[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((session) => {
        if (
          !isObject(session) ||
          typeof session.id !== "string" ||
          typeof session.title !== "string" ||
          typeof session.createdAt !== "string" ||
          typeof session.updatedAt !== "string" ||
          !Array.isArray(session.messages)
        ) {
          return null;
        }

        return {
          id: session.id,
          title: session.title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          messages: session.messages.map(sanitizeMessage).filter(isChatAgentMessage),
        } satisfies ChatSession;
      })
      .filter(isChatSession);
  } catch {
    return [];
  }
}

export function createEmptySession(): ChatSession {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "新会话",
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

function loadStoredSessions(): ChatSession[] {
  if (typeof window === "undefined") return [createEmptySession()];
  const parsed = sanitizeSessions(window.localStorage.getItem(SESSION_STORAGE_KEY));
  return parsed.length > 0 ? parsed : [createEmptySession()];
}

function loadStoredActiveSessionId(sessions: ChatSession[]): string {
  if (typeof window === "undefined") return sessions[0]?.id ?? "";
  const activeId = window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
  return sessions.some((session) => session.id === activeId) ? activeId ?? "" : (sessions[0]?.id ?? "");
}

function reorderSessions(sessions: ChatSession[], activeId: string): ChatSession[] {
  const current = sessions.find((session) => session.id === activeId);
  if (!current) return sessions;
  return [current, ...sessions.filter((session) => session.id !== activeId)];
}

export function useSessionStore() {
  const [{ sessions, activeSessionId }, setStore] = useState(() => {
    const initialSessions = loadStoredSessions();
    return {
      sessions: initialSessions,
      activeSessionId: loadStoredActiveSessionId(initialSessions),
    };
  });

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null,
    [activeSessionId, sessions]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    if (typeof window === "undefined" || !activeSessionId) return;
    window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, activeSessionId);
  }, [activeSessionId]);

  const createSession = useCallback(() => {
    const next = createEmptySession();
    setStore((prev) => ({
      sessions: [next, ...prev.sessions],
      activeSessionId: next.id,
    }));
    return next.id;
  }, []);

  const removeSession = useCallback((sessionId: string) => {
    setStore((prev) => {
      const filtered = prev.sessions.filter((session) => session.id !== sessionId);
      const nextSessions = filtered.length > 0 ? filtered : [createEmptySession()];
      return {
        sessions: nextSessions,
        activeSessionId: prev.activeSessionId === sessionId ? (nextSessions[0]?.id ?? "") : prev.activeSessionId,
      };
    });
  }, []);

  const updateSessionMessages = useCallback((sessionId: string, messages: ChatAgentMessage[]) => {
    setStore((prev) => {
      const nextSessions = prev.sessions.map((session) => {
        if (session.id !== sessionId) return session;
        const updatedAt = new Date().toISOString();
        return {
          ...session,
          title: getSessionTitle(session, messages),
          updatedAt,
          messages,
        };
      });
      return {
        sessions: reorderSessions(nextSessions, sessionId),
        activeSessionId: prev.activeSessionId,
      };
    });
  }, []);

  const setActiveSessionId = useCallback((nextActiveSessionId: string) => {
    setStore((prev) => {
      if (prev.activeSessionId === nextActiveSessionId) {
        return prev;
      }

      return {
        sessions: prev.sessions,
        activeSessionId: nextActiveSessionId,
      };
    });
  }, []);

  return {
    sessions,
    activeSession,
    activeSessionId,
    setActiveSessionId,
    createSession,
    removeSession,
    updateSessionMessages,
  };
}

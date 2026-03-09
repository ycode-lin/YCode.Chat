import type { ApprovalMode, PendingRunDecision } from "../api";

export type ChatRole = "user" | "assistant" | "system";

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

export interface ToolCallState {
  id: string;
  name: string;
  serverName?: string;
  bindingName?: string;
  approvalMode?: ApprovalMode;
  approvalState?: "required" | "approved" | "denied";
  approvalDecision?: PendingRunDecision;
  status: "pending" | "awaiting_approval" | "running" | "success" | "error" | "denied";
  input?: unknown;
  output?: unknown;
  display?: string;
  approvalRequestedAt?: string;
  approvalResolvedAt?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface ChatUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  raw?: unknown;
}

export interface ChatMessageMeta {
  sessionId?: string;
  runId?: string;
  messageId?: string;
  finishReason?: string;
  error?: string | null;
  usage?: ChatUsage;
  reasoningContent?: string;
}

export interface ChatAgentMessage extends ChatTurn {
  timestamp: number;
  toolCalls: ToolCallState[];
  meta?: ChatMessageMeta;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatAgentMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatRuntimeContext {
  modelId: string;
  systemPrompt: string;
}

export interface ChatRequestInput extends ChatRuntimeContext {
  sessionId: string;
  query: string;
  messages?: ChatTurn[];
  stream?: boolean;
}

export interface MessageStartData {
  runId: string;
  sessionId: string;
  messageId: string;
  role: "assistant";
  timestamp: string;
}

export interface TextDeltaData {
  messageId: string;
  delta: string;
}

export interface ReasoningDeltaData {
  messageId: string;
  delta: string;
}

export interface ToolStartData {
  runId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  serverName: string;
  input: unknown;
  timestamp: string;
}

export interface ToolResultData {
  runId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  serverName: string;
  output: unknown;
  display: string;
  status: "success" | "error" | "denied";
  timestamp: string;
}

export interface ToolApprovalRequiredData {
  runId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  serverName: string;
  input: unknown;
  approvalMode: ApprovalMode;
  timestamp: string;
}

export interface ToolApprovalResolvedData {
  runId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  serverName: string;
  decision: PendingRunDecision;
  timestamp: string;
}

export interface MessageEndData {
  messageId: string;
  finishReason: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    raw?: unknown;
  };
  timestamp: string;
}

export interface ErrorEventData {
  messageId?: string;
  code: string;
  message: string;
  timestamp: string;
}

export type ChatSseEvent =
  | { event: "message_start"; data: MessageStartData }
  | { event: "text_delta"; data: TextDeltaData }
  | { event: "reasoning_delta"; data: ReasoningDeltaData }
  | { event: "tool_approval_required"; data: ToolApprovalRequiredData }
  | { event: "tool_approval_resolved"; data: ToolApprovalResolvedData }
  | { event: "tool_start"; data: ToolStartData }
  | { event: "tool_result"; data: ToolResultData }
  | { event: "message_end"; data: MessageEndData }
  | { event: "error"; data: ErrorEventData };

export interface ChatSseChunk {
  event?: string;
  data?: string;
  id?: string;
  retry?: string;
}

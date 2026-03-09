import type { MessageInfo } from "@ant-design/x-sdk";
import type { ChatAgentMessage } from "./types";

export interface RenderableBubbleItem {
  key: string | number;
  role: "user" | "assistant" | "system";
  message: ChatAgentMessage;
  status: MessageInfo<ChatAgentMessage>["status"];
  streaming: boolean;
  toolSummary: string | null;
}

export function formatToolSummary(message: ChatAgentMessage): string | null {
  if (!message.toolCalls.length) return null;

  const awaitingApproval = message.toolCalls.filter((tool) => tool.status === "awaiting_approval").length;
  const running = message.toolCalls.filter((tool) => tool.status === "running" || tool.status === "pending").length;
  const failed = message.toolCalls.filter((tool) => tool.status === "error").length;
  const denied = message.toolCalls.filter((tool) => tool.status === "denied").length;

  if (awaitingApproval > 0) {
    return `等待审批 ${awaitingApproval} 个工具`;
  }

  if (running > 0) {
    return `正在调用 ${running} 个工具`;
  }

  if (denied > 0) {
    return `工具审批已拒绝 ${denied} 个`;
  }

  if (failed > 0) {
    return `工具执行完成，${failed} 个失败`;
  }

  return `已调用 ${message.toolCalls.length} 个工具`;
}

export function getSessionPreview(messages: ChatAgentMessage[]): string {
  const lastText = [...messages].reverse().find((message) => message.content.trim())?.content?.trim();
  if (!lastText) return "还没有消息";
  return lastText.length > 48 ? `${lastText.slice(0, 48)}...` : lastText;
}

export function mapMessageInfoToBubbleItems(messages: MessageInfo<ChatAgentMessage>[]): RenderableBubbleItem[] {
  return messages.map((info) => ({
    key: info.id,
    role: info.message.role,
    message: info.message,
    status: info.status,
    streaming: info.status === "loading" || info.status === "updating",
    toolSummary: formatToolSummary(info.message),
  }));
}

export function getLatestTraceMessage(messages: MessageInfo<ChatAgentMessage>[]): MessageInfo<ChatAgentMessage> | null {
  const matched = [...messages]
    .reverse()
    .find((info) => info.message.role === "assistant" && info.message.toolCalls.length > 0);

  return matched ?? null;
}

export function getTraceMessageById(
  messages: MessageInfo<ChatAgentMessage>[],
  messageId: string | number | null
): MessageInfo<ChatAgentMessage> | null {
  if (messageId === null) return getLatestTraceMessage(messages);
  return messages.find((info) => info.id === messageId) ?? getLatestTraceMessage(messages);
}

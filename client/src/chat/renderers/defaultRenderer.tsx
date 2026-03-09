import { Card } from "antd";
import ChatBubbleList from "../components/ChatBubbleList";
import type { ChatRendererProps } from "./types";

export default function DefaultChatRenderer({
  hasMessages,
  bubbleItems,
  sender,
  emptyState,
  onResolveApproval,
  isToolApprovalLoading,
}: ChatRendererProps) {
  if (!hasMessages) {
    return emptyState;
  }

  return (
    <>
      <div className="app-chat-layout">
        <Card className="app-panel app-message-surface min-h-0 overflow-hidden" bodyStyle={{ padding: 0, height: "100%" }}>
          <div className="app-scroll flex h-full flex-col overflow-y-auto px-6 py-6">
            <ChatBubbleList
              items={bubbleItems}
              onResolveApproval={onResolveApproval}
              isToolApprovalLoading={isToolApprovalLoading}
            />
          </div>
        </Card>
      </div>
      {sender}
    </>
  );
}

import { RobotOutlined, UserOutlined } from "@ant-design/icons";
import { Bubble } from "@ant-design/x";
import { Avatar } from "antd";
import MarkdownBubbleContent from "./MarkdownBubbleContent";
import type { RenderableBubbleItem } from "../messageMapper";
import type { PendingRunDecision } from "../../api";
import type { ChatAgentMessage, ToolCallState } from "../types";

interface ChatBubbleListProps {
  items: RenderableBubbleItem[];
  onResolveApproval?: (message: ChatAgentMessage, tool: ToolCallState, decision: PendingRunDecision) => Promise<void> | void;
  isToolApprovalLoading?: (message: ChatAgentMessage, tool: ToolCallState) => boolean;
}

export default function ChatBubbleList({
  items,
  onResolveApproval,
  isToolApprovalLoading,
}: ChatBubbleListProps) {
  return (
    <Bubble.List
      items={items.map((item) => ({
        key: item.key,
        role: item.role === "assistant" ? "ai" : item.role,
        content: item.message,
        extraInfo: {
          status: item.status,
          streaming: item.streaming,
          messageId: item.key,
          toolSummary: item.toolSummary,
        },
      }))}
      autoScroll
      className="app-x-bubble-list"
      role={{
        ai: {
          placement: "start",
          variant: "borderless",
          avatar: <Avatar className="app-x-bubble-avatar" icon={<RobotOutlined />} />,
          rootClassName: "app-x-bubble-ai",
          contentRender: (content, info) => (
            <MarkdownBubbleContent
              message={content}
              streaming={Boolean(info.extraInfo?.streaming)}
              summary={typeof info.extraInfo?.toolSummary === "string" ? info.extraInfo.toolSummary : null}
              onResolveApproval={onResolveApproval}
              isToolApprovalLoading={isToolApprovalLoading}
            />
          ),
        },
        user: {
          placement: "end",
          variant: "shadow",
          avatar: <Avatar className="app-x-bubble-avatar app-x-bubble-avatar-user" icon={<UserOutlined />} />,
          rootClassName: "app-x-bubble-user",
          contentRender: (content) => <MarkdownBubbleContent message={content} streaming={false} />,
        },
        system: {
          placement: "start",
          variant: "outlined",
          rootClassName: "app-x-bubble-system",
          contentRender: (content) => <MarkdownBubbleContent message={content} streaming={false} />,
        },
      }}
    />
  );
}

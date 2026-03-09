import type { ReactNode } from "react";
import type { PendingRunDecision } from "../../api";
import type { RenderableBubbleItem } from "../messageMapper";
import type { ChatAgentMessage, ToolCallState } from "../types";

export interface ChatRendererProps {
  hasMessages: boolean;
  bubbleItems: RenderableBubbleItem[];
  sender: ReactNode;
  emptyState: ReactNode;
  onResolveApproval?: (message: ChatAgentMessage, tool: ToolCallState, decision: PendingRunDecision) => Promise<void> | void;
  isToolApprovalLoading?: (message: ChatAgentMessage, tool: ToolCallState) => boolean;
}

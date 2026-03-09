import { Alert, Button, Tag, Typography } from "antd";
import type { PendingRunDecision } from "../../api";
import type { ChatAgentMessage, ToolCallState } from "../types";

const { Paragraph, Text } = Typography;

function formatValue(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

interface ToolResultCardProps {
  message: ChatAgentMessage;
  tool: ToolCallState;
  onResolveApproval?: (message: ChatAgentMessage, tool: ToolCallState, decision: PendingRunDecision) => Promise<void> | void;
  approvalLoading?: boolean;
}

export default function ToolResultCard({
  message,
  tool,
  onResolveApproval,
  approvalLoading = false,
}: ToolResultCardProps) {
  const inputText = formatValue(tool.input);
  const outputText = formatValue(tool.output);
  const showApprovalActions = tool.status === "awaiting_approval" && Boolean(onResolveApproval);
  const approvalStateLabel =
    tool.approvalState === "approved" ? "已批准" : tool.approvalState === "denied" ? "已拒绝" : tool.approvalState === "required" ? "待审批" : null;

  return (
    <div className="app-tool-card">
      <div className="app-tool-meta-row">
        {tool.serverName ? (
          <Tag bordered={false} className="app-tool-meta-tag">
            MCP: {tool.serverName}
          </Tag>
        ) : null}
        {tool.approvalMode ? (
          <Tag bordered={false} className="app-tool-meta-tag">
            {tool.approvalMode === "manual" ? "Manual 审批" : "Solo 自动执行"}
          </Tag>
        ) : null}
        {approvalStateLabel ? (
          <Tag bordered={false} className={`app-tool-meta-tag ${tool.approvalState === "denied" ? "is-danger" : "is-accent"}`}>
            {approvalStateLabel}
          </Tag>
        ) : null}
      </div>

      {showApprovalActions ? (
        <div className="app-tool-approval-box">
          <Alert
            type="warning"
            showIcon
            message="工具调用等待你的审批"
            description={`确认后才会继续执行 ${tool.name}，拒绝后模型会收到“已拒绝执行”的结果并继续回复。`}
          />
          <div className="app-tool-approval-actions">
            <Button
              type="primary"
              className="app-btn"
              loading={approvalLoading}
              onClick={() => void onResolveApproval?.(message, tool, "approve")}
            >
              Approve
            </Button>
            <Button
              danger
              className="app-btn"
              disabled={approvalLoading}
              onClick={() => void onResolveApproval?.(message, tool, "deny")}
            >
              Deny
            </Button>
          </div>
        </div>
      ) : null}

      {tool.display ? (
        <Paragraph className="app-text !mb-3 whitespace-pre-wrap">
          {tool.display}
        </Paragraph>
      ) : null}

      {inputText ? (
        <div className="app-tool-block">
          <Text className="app-muted text-xs uppercase">Input</Text>
          <pre className="app-tool-json">{inputText}</pre>
        </div>
      ) : null}

      {outputText ? (
        <div className="app-tool-block">
          <Text className="app-muted text-xs uppercase">Output</Text>
          <pre className="app-tool-json">{outputText}</pre>
        </div>
      ) : null}
    </div>
  );
}

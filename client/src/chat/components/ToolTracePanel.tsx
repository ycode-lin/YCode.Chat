import { CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, ToolOutlined } from "@ant-design/icons";
import { Badge, Card, Collapse, Empty, Typography } from "antd";
import ToolResultCard from "./ToolResultCard";
import type { ChatAgentMessage, ToolCallState } from "../types";

const { Text } = Typography;

function getToolStatusIcon(tool: ToolCallState) {
  if (tool.status === "running" || tool.status === "pending" || tool.status === "awaiting_approval") return <ClockCircleOutlined />;
  if (tool.status === "error" || tool.status === "denied") return <CloseCircleOutlined />;
  return <CheckCircleOutlined />;
}

function getToolStatusText(tool: ToolCallState): string {
  if (tool.status === "awaiting_approval") return "待审批";
  if (tool.status === "running" || tool.status === "pending") return "运行中";
  if (tool.status === "denied") return "已拒绝";
  if (tool.status === "error") return "失败";
  return "完成";
}

interface ToolTracePanelProps {
  message: ChatAgentMessage | null;
}

export default function ToolTracePanel({ message }: ToolTracePanelProps) {
  return (
    <Card className="app-panel app-trace-panel" bodyStyle={{ padding: 16, height: "100%" }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ToolOutlined className="app-subtle" />
          <Text strong className="app-text">
            Tool Trace
          </Text>
        </div>
        {message?.toolCalls.length ? (
          <Badge count={message.toolCalls.length} color="var(--app-accent)" />
        ) : null}
      </div>

      {message?.toolCalls.length ? (
        <Collapse
          bordered={false}
          className="app-tool-collapse"
          items={message.toolCalls.map((tool) => ({
            key: tool.id,
            label: (
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`app-tool-status app-tool-status-${tool.status}`}>{getToolStatusIcon(tool)}</span>
                  <Text className="app-text truncate">{tool.name}</Text>
                </div>
                <Text className="app-muted shrink-0 text-xs">{getToolStatusText(tool)}</Text>
              </div>
            ),
            children: <ToolResultCard message={message} tool={tool} />,
          }))}
        />
      ) : (
        <div className="app-trace-empty">
          <Empty description="当前回复还没有工具轨迹" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      )}
    </Card>
  );
}

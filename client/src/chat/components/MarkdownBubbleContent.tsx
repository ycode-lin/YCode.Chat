import { CodeHighlighter, Mermaid } from "@ant-design/x";
import { ThoughtChain } from "@ant-design/x";
import { XMarkdown } from "@ant-design/x-markdown";
import Latex from "@ant-design/x-markdown/plugins/Latex";
import { Collapse, Tag } from "antd";
import { Children, useMemo, useState, type ReactNode } from "react";
import type { PendingRunDecision } from "../../api";
import type { ChatAgentMessage, ToolCallState } from "../types";
import ToolResultCard from "./ToolResultCard";

function renderNodeText(children: ReactNode): string {
  return Children.toArray(children).join("").replace(/\n$/, "");
}

function MarkdownCodeBlock(props: Record<string, unknown>) {
  const code = renderNodeText(props.children as ReactNode);
  const rawLang = typeof props.lang === "string" ? props.lang : "";
  const lang = rawLang.trim().split(/\s+/)[0];
  const streamStatus = props.streamStatus === "loading" ? "loading" : "done";
  const isBlock = props.block === true;

  if (!isBlock) {
    return <code className="app-x-markdown-inline-code">{props.children as string}</code>;
  }

  if (lang === "mermaid") {
    if (streamStatus === "loading") {
      return (
        <CodeHighlighter lang="mermaid" header={null} className="app-x-code-block">
          {code}
        </CodeHighlighter>
      );
    }

    return (
      <Mermaid header={null} className="app-x-mermaid">
        {code}
      </Mermaid>
    );
  }

  return (
    <CodeHighlighter lang={lang || undefined} header={lang ? undefined : null} className="app-x-code-block">
      {code}
    </CodeHighlighter>
  );
}

const MARKDOWN_COMPONENTS = {
  code: MarkdownCodeBlock,
};

const MARKDOWN_CONFIG = {
  extensions: Latex({
    replaceAlignStart: true,
  }),
};

function ThinkingBubble() {
  return (
    <div className="app-thinking-bubble" aria-label="AI 正在思考">
      <div className="app-thinking-row">
        <span className="app-thinking-dot" />
        <span className="app-thinking-dot" />
        <span className="app-thinking-dot" />
      </div>
      <div className="app-thinking-label">正在思考</div>
    </div>
  );
}

interface MarkdownBubbleContentProps {
  message: ChatAgentMessage;
  streaming: boolean;
  summary?: string | null;
  onResolveApproval?: (message: ChatAgentMessage, tool: ToolCallState, decision: PendingRunDecision) => Promise<void> | void;
  isToolApprovalLoading?: (message: ChatAgentMessage, tool: ToolCallState) => boolean;
}

export default function MarkdownBubbleContent({
  message,
  streaming,
  summary,
  onResolveApproval,
  isToolApprovalLoading,
}: MarkdownBubbleContentProps) {
  const reasoningContent = message.meta?.reasoningContent?.trim() ?? "";
  const [reasoningExpanded, setReasoningExpanded] = useState(true);
  const showThinking =
    streaming && !message.content.trim() && !reasoningContent && !message.toolCalls.length && !message.meta?.error;
  const reasoningActiveKey = reasoningExpanded ? ["reasoning"] : [];
  const isReasoningReceiving = streaming && Boolean(reasoningContent);
  const reasoningLabel = useMemo(
    () => (
      <div className="app-reasoning-header">
        <span className="app-reasoning-label">思考过程</span>
      </div>
    ),
    []
  );
  const inlineToolItems = useMemo(
    () =>
      message.toolCalls.map((tool) => ({
        key: tool.id,
        title: tool.name,
        description: tool.display || undefined,
        status:
          tool.status === "success"
            ? ("success" as const)
            : tool.status === "error" || tool.status === "denied"
              ? ("error" as const)
              : ("loading" as const),
        collapsible: true,
        content: (
          <ToolResultCard
            message={message}
            tool={tool}
            onResolveApproval={onResolveApproval}
            approvalLoading={Boolean(isToolApprovalLoading?.(message, tool))}
          />
        ),
      })),
    [isToolApprovalLoading, message, message.toolCalls, onResolveApproval]
  );

  return (
    <div className={`app-x-bubble-content ${showThinking ? "app-x-bubble-thinking-state" : ""}`}>
      {reasoningContent ? (
        <div className="app-reasoning-shell">
          <Collapse
            bordered={false}
            className="app-reasoning-collapse"
            activeKey={reasoningActiveKey}
            onChange={(keys) => {
              const nextKeys = Array.isArray(keys) ? keys : [keys];
              setReasoningExpanded(nextKeys.includes("reasoning"));
            }}
            items={[
              {
                key: "reasoning",
                label: reasoningLabel,
                children: (
                  <div className="app-reasoning-body">
                    <XMarkdown
                      content={reasoningContent}
                      rootClassName="app-x-markdown app-x-reasoning-markdown"
                      components={MARKDOWN_COMPONENTS}
                      config={MARKDOWN_CONFIG}
                      openLinksInNewTab
                      escapeRawHtml
                      streaming={{
                        hasNextChunk: streaming,
                        enableAnimation: true,
                      }}
                    />
                    {isReasoningReceiving ? (
                      <div className="app-reasoning-footer">
                        <span className="app-reasoning-status app-reasoning-status-inline">
                          <span className="app-reasoning-status-dots" aria-hidden="true">
                            <span />
                            <span />
                            <span />
                          </span>
                          <span>思考中</span>
                        </span>
                      </div>
                    ) : null}
                  </div>
                ),
              },
            ]}
          />
          {isReasoningReceiving && !reasoningExpanded ? (
            <div className="app-reasoning-collapsed-status">
              <span className="app-reasoning-status app-reasoning-status-inline">
                <span className="app-reasoning-status-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <span>思考中</span>
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {showThinking ? (
        <ThinkingBubble />
      ) : (
        <XMarkdown
          content={message.content}
          rootClassName="app-x-markdown"
          components={MARKDOWN_COMPONENTS}
          config={MARKDOWN_CONFIG}
          openLinksInNewTab
          escapeRawHtml
          streaming={{
            hasNextChunk: streaming,
            enableAnimation: true,
          }}
        />
      )}

      {summary || message.meta?.error ? (
        <div className="app-bubble-summary">
          {summary ? (
            <Tag bordered={false} className="app-tool-summary-tag">
              {summary}
            </Tag>
          ) : null}
          {message.meta?.error ? (
            <Tag color="error" bordered={false}>
              {message.meta.error}
            </Tag>
          ) : null}
        </div>
      ) : null}

      {inlineToolItems.length > 0 ? (
        <div className="app-inline-tools">
          <ThoughtChain
            items={inlineToolItems}
            line="dashed"
            className="app-inline-tool-chain"
            defaultExpandedKeys={inlineToolItems.length === 1 ? [inlineToolItems[0]?.key ?? ""] : []}
          />
        </div>
      ) : null}
    </div>
  );
}

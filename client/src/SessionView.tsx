import { DeleteOutlined, PlusOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { Welcome } from "@ant-design/x";
import { Button, Drawer, List, Popconfirm, Tooltip, Typography } from "antd";
import { useEffect, useState } from "react";
import ChatSender from "./chat/components/ChatSender";
import { getSessionPreview } from "./chat/messageMapper";
import DefaultChatRenderer from "./chat/renderers/defaultRenderer";
import { useSessionStore } from "./chat/sessionStore";
import { useSessionChat } from "./chat/useSessionChat";

const { Text } = Typography;

const EMPTY_STAGE_PROMPTS = [
  "有什么可以帮忙的？",
  "今天想一起解决什么问题？",
  "把你的任务交给我吧。",
  "想从哪件事开始？",
  "现在先处理哪件事？",
];

interface SessionViewProps {
  modelId: string;
  currentPromptText: string;
}

interface SessionConversationPaneProps {
  activeSessionId: string;
  sessionMessages: Parameters<typeof useSessionChat>[0]["sessionMessages"];
  runtimeContext: Parameters<typeof useSessionChat>[0]["runtimeContext"];
  onPersistMessages: Parameters<typeof useSessionChat>[0]["onPersistMessages"];
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSessionMeta(value: string | undefined): string {
  if (!value) return "刚刚更新";
  return `${formatTime(value)} 更新`;
}

function pickRandomPrompt(): string {
  return EMPTY_STAGE_PROMPTS[Math.floor(Math.random() * EMPTY_STAGE_PROMPTS.length)] ?? EMPTY_STAGE_PROMPTS[0];
}

function SessionConversationPane({
  activeSessionId,
  sessionMessages,
  runtimeContext,
  onPersistMessages,
}: SessionConversationPaneProps) {
  const [input, setInput] = useState("");
  const [emptyStagePrompt, setEmptyStagePrompt] = useState(() => pickRandomPrompt());
  const {
    messages,
    bubbleItems,
    isRequesting,
    abort,
    send,
    resolveToolApproval,
    isToolApprovalLoading,
  } = useSessionChat({
    activeSessionId,
    sessionMessages,
    runtimeContext,
    onPersistMessages,
  });
  const hasMessages = messages.length > 0;

  useEffect(() => {
    if (!hasMessages) {
      setEmptyStagePrompt(pickRandomPrompt());
    }
  }, [activeSessionId, hasMessages]);

  const handleSubmit = (value: string) => {
    const text = value.trim();
    if (!text || !runtimeContext.modelId) return;
    send(text);
    setInput("");
  };

  const senderNode = <ChatSender value={input} onChange={setInput} onSubmit={handleSubmit} onCancel={abort} loading={isRequesting} />;
  const emptyStateNode = (
    <div className="app-empty-stage flex-1">
      <div className="app-empty-inner">
        <div className="app-empty-copy">
          <Welcome
            variant="borderless"
            title={emptyStagePrompt}
            className="app-x-welcome"
            styles={{
              title: {
                color: "var(--app-text)",
                fontSize: "clamp(28px, 4vw, 42px)",
                fontWeight: 600,
                letterSpacing: "-0.03em",
                textAlign: "center",
              },
              root: {
                justifyContent: "center",
              },
            }}
          />
        </div>
        <ChatSender
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          onCancel={abort}
          loading={isRequesting}
          empty
        />
      </div>
    </div>
  );

  return (
    <DefaultChatRenderer
      hasMessages={hasMessages}
      bubbleItems={bubbleItems}
      sender={senderNode}
      emptyState={emptyStateNode}
      onResolveApproval={resolveToolApproval}
      isToolApprovalLoading={isToolApprovalLoading}
    />
  );
}

export default function SessionView({ modelId, currentPromptText }: SessionViewProps) {
  const { sessions, activeSession, activeSessionId, setActiveSessionId, createSession, removeSession, updateSessionMessages } =
    useSessionStore();
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Text strong className="app-text block truncate text-base">
            {activeSession?.title || "新会话"}
          </Text>
          <Text className="app-muted block text-xs">
            {activeSession?.messages.length ?? 0} 条消息 · {formatSessionMeta(activeSession?.updatedAt)}
          </Text>
        </div>
        <div className="flex items-center gap-3">
          <Button type="primary" icon={<PlusOutlined />} className="app-btn" onClick={createSession}>
            新会话
          </Button>
          <Tooltip title="会话列表">
            <Button
              icon={<UnorderedListOutlined />}
              aria-label="会话列表"
              className="app-icon-btn !p-0"
              onClick={() => setSessionDrawerOpen(true)}
            />
          </Tooltip>
        </div>
      </div>

      <SessionConversationPane
        key={activeSessionId}
        activeSessionId={activeSessionId}
        sessionMessages={activeSession?.messages ?? []}
        runtimeContext={{
          modelId,
          systemPrompt: currentPromptText,
        }}
        onPersistMessages={updateSessionMessages}
      />

      <Drawer
        title="会话历史"
        placement="right"
        width={360}
        onClose={() => setSessionDrawerOpen(false)}
        open={sessionDrawerOpen}
      >
        <div className="app-scroll flex h-full flex-col overflow-y-auto">
          <List
            split={false}
            dataSource={sessions}
            renderItem={(session) => (
              <List.Item className="!px-0 !py-1.5">
                <div
                  role="button"
                  tabIndex={0}
                  className={`app-session-item w-full cursor-pointer rounded-2xl px-4 py-3 text-left ${
                    session.id === activeSession?.id ? "app-session-item-active" : ""
                  }`}
                  onClick={() => {
                    setActiveSessionId(session.id);
                    setSessionDrawerOpen(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setActiveSessionId(session.id);
                      setSessionDrawerOpen(false);
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Text strong className="app-text block truncate">
                        {session.title}
                      </Text>
                      <Text className="app-muted block text-xs">
                        {getSessionPreview(session.messages)}
                      </Text>
                      <Text className="app-muted mt-2 block text-[11px]">
                        {formatTime(session.updatedAt)}
                      </Text>
                    </div>
                    <Popconfirm
                      title="删除这个会话？"
                      description="仅删除本地历史，无法恢复。"
                      okText="删除"
                      cancelText="取消"
                      onConfirm={() => removeSession(session.id)}
                    >
                      <Button
                        type="text"
                        size="small"
                        aria-label="删除会话"
                        icon={<DeleteOutlined />}
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                      />
                    </Popconfirm>
                  </div>
                </div>
              </List.Item>
            )}
          />
        </div>
      </Drawer>
    </div>
  );
}

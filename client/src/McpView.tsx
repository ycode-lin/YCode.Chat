import { CaretRightOutlined, ReloadOutlined } from "@ant-design/icons";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, Button, Card, Collapse, Empty, Input, Radio, Switch, Tabs, Tag, Tooltip, Typography, message } from "antd";
import type { ApprovalMode, McpOverview } from "./api";
import { fetchMcpOverview, setMcpConfig } from "./api";

const { Paragraph, Text, Title } = Typography;
const { TextArea } = Input;

interface McpViewProps {
  onToolsChange?: (count: number) => void;
}

const DEFAULT_JSON_TEMPLATE = `{
  "mcpServers": {}
}`;

const DETAILED_JSON_PLACEHOLDER = `{
  "mcpServers": {
    "your-server-name": {
      "enabled": true,
      "type": "streamableHttp",
      "url": "https://your-mcp-server-url/mcp"
    }
  }
}`;

interface DraftServer {
  name: string;
  transport: "stdio" | "sse" | "streamableHttp";
  target: string;
}

const JSON_FORMAT_DEBOUNCE_MS = 700;
const JSON_FORMAT_THROTTLE_MS = 1800;
const AUTO_REFRESH_DEBOUNCE_MS = 1800;
const AUTO_REFRESH_THROTTLE_MS = 4000;

function parseConfigObject(raw: string): Record<string, unknown> {
  if (!raw.trim()) return { mcpServers: {} };
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("mcp.json 必须是一个对象。");
  }
  return parsed as Record<string, unknown>;
}

function getServersContainer(config: Record<string, unknown>): Record<string, unknown> {
  const current = config.mcpServers;
  if (current && typeof current === "object" && !Array.isArray(current)) {
    return current as Record<string, unknown>;
  }
  if (!("mcpServers" in config) && Object.keys(config).length === 0) {
    config.mcpServers = {};
    return config.mcpServers as Record<string, unknown>;
  }
  if (!("mcpServers" in config)) {
    return config;
  }
  config.mcpServers = {};
  return config.mcpServers as Record<string, unknown>;
}

function extractServerEntries(parsed: Record<string, unknown>): Record<string, unknown> {
  const scoped = parsed.mcpServers;
  if (scoped && typeof scoped === "object" && !Array.isArray(scoped)) {
    return scoped as Record<string, unknown>;
  }
  return parsed;
}

function parseDraftServers(raw: string): { servers: DraftServer[]; error: string | null } {
  if (!raw.trim()) return { servers: [], error: null };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { servers: [], error: "mcp.json 必须是一个对象。" };
    }
    const serverEntries = extractServerEntries(parsed);
    const servers = Object.entries(serverEntries).reduce<DraftServer[]>((acc, [name, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return acc;
      const config = value as Record<string, unknown>;
      const transport = config.transport ?? config.type;
      if ((transport === "stdio" || (transport === undefined && typeof config.command === "string")) && typeof config.command === "string") {
        const args = Array.isArray(config.args)
          ? config.args.filter((item): item is string => typeof item === "string")
          : [];
        acc.push({ name, transport: "stdio", target: [config.command, ...args].join(" ").trim() });
        return acc;
      }
      if (
        (transport === "sse" || transport === "http" || transport === "streamableHttp" || transport === undefined) &&
        typeof config.url === "string"
      ) {
        const remoteTransport: DraftServer["transport"] = transport === "sse" ? "sse" : "streamableHttp";
        acc.push({ name, transport: remoteTransport, target: config.url });
      }
      return acc;
    }, []);
    return { servers, error: null };
  } catch (error) {
    return {
      servers: [],
      error: error instanceof Error ? error.message : "mcp.json 解析失败",
    };
  }
}

function formatJsonIfValid(raw: string): string | null {
  if (!raw.trim()) return null;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return null;
  }
}

function normalizeConfigForSync(raw: string): string {
  const formatted = formatJsonIfValid(raw);
  return formatted ?? raw.trim();
}

function canSyncConfig(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function getOverviewToolCount(overview: McpOverview): number {
  return overview.servers.reduce((total, server) => total + server.toolCount, 0);
}

function getStatusLabel(status: "configured" | "ready" | "error" | "disabled"): string {
  if (status === "ready") return "可用";
  if (status === "error") return "异常";
  if (status === "disabled") return "已停用";
  return "待连接";
}

function getStatusClassName(status: "configured" | "ready" | "error" | "disabled"): string {
  if (status === "ready") return "is-ready";
  if (status === "error") return "is-error";
  if (status === "disabled") return "is-disabled";
  return "is-configured";
}

interface OverflowTagItem {
  key: string;
  label: string;
  className: string;
}

function McpOverflowTags({ items }: { items: OverflowTagItem[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const measureTagRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const measureMoreRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const [visibleCount, setVisibleCount] = useState(items.length);
  const gapPx = 8;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      setVisibleCount(items.length);
      return;
    }

    const computeVisibleCount = () => {
      const containerWidth = container.clientWidth;
      if (containerWidth <= 0) {
        setVisibleCount(items.length);
        return;
      }

      const tagWidths = items.map((_, index) => measureTagRefs.current[index]?.offsetWidth ?? 0);
      const missingWidth = tagWidths.some((width) => width <= 0);
      if (missingWidth) {
        setVisibleCount(items.length);
        return;
      }

      const totalWidth = tagWidths.reduce((sum, width) => sum + width, 0) + gapPx * Math.max(0, items.length - 1);
      if (totalWidth <= containerWidth) {
        setVisibleCount(items.length);
        return;
      }

      for (let nextVisibleCount = items.length - 1; nextVisibleCount >= 0; nextVisibleCount -= 1) {
        const hiddenCount = items.length - nextVisibleCount;
        const moreWidth = measureMoreRefs.current[hiddenCount - 1]?.offsetWidth ?? 0;
        if (moreWidth <= 0) continue;

        const visibleWidth = tagWidths.slice(0, nextVisibleCount).reduce((sum, width) => sum + width, 0);
        const visibleGaps = gapPx * Math.max(0, nextVisibleCount - 1);
        const hasVisibleTags = nextVisibleCount > 0;
        const requiredWidth = visibleWidth + visibleGaps + (hasVisibleTags ? gapPx : 0) + moreWidth;

        if (requiredWidth <= containerWidth) {
          setVisibleCount(nextVisibleCount);
          return;
        }
      }

      setVisibleCount(0);
    };

    computeVisibleCount();
    const resizeObserver = new ResizeObserver(computeVisibleCount);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [items]);

  const hiddenItems = items.slice(visibleCount);

  return (
    <>
      <div className="app-mcp-meta-tags" ref={containerRef}>
        {items.slice(0, visibleCount).map((item) => (
          <Tag key={item.key} className={`app-mcp-chip ${item.className}`}>
            {item.label}
          </Tag>
        ))}
        {hiddenItems.length > 0 ? (
          <Tooltip title={hiddenItems.map((item) => item.label).join(" / ")}>
            <Tag className="app-mcp-chip app-mcp-chip-more">+{hiddenItems.length}</Tag>
          </Tooltip>
        ) : null}
      </div>
      <div className="app-mcp-meta-tags-measure" aria-hidden>
        {items.map((item, index) => (
          <Tag
            key={`measure-${item.key}`}
            className={`app-mcp-chip ${item.className}`}
            ref={(node) => {
              measureTagRefs.current[index] = node;
            }}
          >
            {item.label}
          </Tag>
        ))}
        {items.map((_, index) => (
          <Tag
            key={`measure-more-${index + 1}`}
            className="app-mcp-chip app-mcp-chip-more"
            ref={(node) => {
              measureMoreRefs.current[index] = node;
            }}
          >
            +{index + 1}
          </Tag>
        ))}
      </div>
    </>
  );
}

export default function McpView({ onToolsChange }: McpViewProps) {
  const [messageApi, contextHolder] = message.useMessage();
  const [activeTab, setActiveTab] = useState("remote-servers");
  const [configJson, setConfigJson] = useState(DEFAULT_JSON_TEMPLATE);
  const [serverName, setServerName] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [remoteTransport, setRemoteTransport] = useState<"streamableHttp" | "sse">("streamableHttp");
  const [remoteApprovalMode, setRemoteApprovalMode] = useState<ApprovalMode>("solo");
  const [overview, setOverview] = useState<McpOverview>({
    config: "",
    servers: [],
    tools: [],
    error: null,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [remoteFormError, setRemoteFormError] = useState<string | null>(null);
  const formatTimerRef = useRef<number | null>(null);
  const autoRefreshTimerRef = useRef<number | null>(null);
  const lastFormatAtRef = useRef(0);
  const lastRefreshAtRef = useRef(0);
  const refreshRequestIdRef = useRef(0);
  const lastSyncedJsonRef = useRef("");
  const configJsonRef = useRef(configJson);

  useEffect(() => {
    configJsonRef.current = configJson;
  }, [configJson]);

  useEffect(() => {
    return () => {
      if (formatTimerRef.current !== null) {
        window.clearTimeout(formatTimerRef.current);
      }
      if (autoRefreshTimerRef.current !== null) {
        window.clearTimeout(autoRefreshTimerRef.current);
      }
    };
  }, []);

  const loadOverview = async ({
    silent = false,
    syncEditor = false,
  }: { silent?: boolean; syncEditor?: boolean } = {}) => {
    if (!silent) {
      setConfigError(null);
    }
    try {
      const next = await fetchMcpOverview();
      const nextToolCount = getOverviewToolCount(next);
      const shouldSuppressOverviewError =
        silent &&
        !next.config.trim() &&
        next.servers.length === 0 &&
        nextToolCount === 0;

      setOverview(shouldSuppressOverviewError ? { ...next, error: null } : next);
      if (syncEditor) {
        const normalizedConfig = normalizeConfigForSync(next.config);
        const nextConfig = normalizedConfig || DEFAULT_JSON_TEMPLATE;
        setConfigJson(nextConfig);
      }
      lastSyncedJsonRef.current = normalizeConfigForSync(next.config);
      onToolsChange?.(nextToolCount);
    } catch (e) {
      if (!silent) {
        setConfigError(e instanceof Error ? e.message : "加载失败");
      }
      onToolsChange?.(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOverview({ silent: true, syncEditor: true });
  }, []);

  const cancelScheduledAutoRefresh = () => {
    if (autoRefreshTimerRef.current !== null) {
      window.clearTimeout(autoRefreshTimerRef.current);
      autoRefreshTimerRef.current = null;
    }
  };

  const refreshTools = async ({
    config,
    force = false,
    showSuccess = false,
  }: {
    config: string;
    force?: boolean;
    showSuccess?: boolean;
  }) => {
    if (!canSyncConfig(config)) {
      throw new Error("mcp.json 不是有效的 JSON");
    }

    const normalizedConfig = normalizeConfigForSync(config);

    if (!force && normalizedConfig === lastSyncedJsonRef.current) {
      return;
    }

    cancelScheduledAutoRefresh();
    setRefreshing(true);
    setConfigError(null);

    const requestId = ++refreshRequestIdRef.current;

    try {
      await setMcpConfig(normalizedConfig);
      if (requestId !== refreshRequestIdRef.current) return;

      lastRefreshAtRef.current = Date.now();
      lastSyncedJsonRef.current = normalizedConfig;
      await loadOverview({ syncEditor: false });
      if (requestId !== refreshRequestIdRef.current) return;

      if (showSuccess) {
        void messageApi.success("MCP 配置已刷新");
      }
    } catch (e) {
      if (requestId !== refreshRequestIdRef.current) return;
      setConfigError(e instanceof Error ? e.message : "刷新配置失败");
    } finally {
      if (requestId === refreshRequestIdRef.current) {
        setRefreshing(false);
      }
    }
  };

  const scheduleJsonFormatting = (nextValue: string) => {
    if (formatTimerRef.current !== null) {
      window.clearTimeout(formatTimerRef.current);
      formatTimerRef.current = null;
    }

    const formatted = formatJsonIfValid(nextValue);
    if (!formatted || formatted === nextValue) {
      return;
    }

    const elapsed = Date.now() - lastFormatAtRef.current;
    const waitMs = Math.max(JSON_FORMAT_DEBOUNCE_MS, JSON_FORMAT_THROTTLE_MS - elapsed, 0);

    formatTimerRef.current = window.setTimeout(() => {
      const latestValue = configJsonRef.current;
      const latestFormatted = formatJsonIfValid(latestValue);
      if (!latestFormatted || latestFormatted === latestValue) {
        formatTimerRef.current = null;
        return;
      }

      lastFormatAtRef.current = Date.now();
      formatTimerRef.current = null;
      setConfigJson(latestFormatted);
    }, waitMs);
  };

  const scheduleAutoRefresh = (nextValue: string) => {
    cancelScheduledAutoRefresh();

    if (!canSyncConfig(nextValue)) {
      return;
    }

    const normalizedConfig = normalizeConfigForSync(nextValue);
    if (normalizedConfig === lastSyncedJsonRef.current) {
      return;
    }

    const elapsed = Date.now() - lastRefreshAtRef.current;
    const waitMs = Math.max(AUTO_REFRESH_DEBOUNCE_MS, AUTO_REFRESH_THROTTLE_MS - elapsed, 0);

    autoRefreshTimerRef.current = window.setTimeout(() => {
      autoRefreshTimerRef.current = null;
      const latestValue = configJsonRef.current;
      if (!canSyncConfig(latestValue)) {
        return;
      }

      const latestNormalizedConfig = normalizeConfigForSync(latestValue);
      if (latestNormalizedConfig === lastSyncedJsonRef.current) return;

      void refreshTools({ config: latestValue });
    }, waitMs);
  };

  const handleConfigChange = (nextValue: string) => {
    setConfigJson(nextValue);
    setConfigError(null);
    scheduleJsonFormatting(nextValue);
    scheduleAutoRefresh(nextValue);
  };

  const handleServerEnabledChange = (name: string, enabled: boolean) => {
    try {
      const nextConfig = parseConfigObject(configJsonRef.current);
      const servers = getServersContainer(nextConfig);
      const current = servers[name];

      if (!current || typeof current !== "object" || Array.isArray(current)) {
        throw new Error(`未找到 ${name} 的配置`);
      }

      servers[name] = {
        ...(current as Record<string, unknown>),
        enabled,
      };

      const nextJson = JSON.stringify(nextConfig, null, 2);
      cancelScheduledAutoRefresh();
      setConfigJson(nextJson);
      setConfigError(null);
      void refreshTools({ config: nextJson, force: true });
      void messageApi.success(enabled ? `已启用 ${name}` : `已停用 ${name}`);
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : "更新 MCP 服务状态失败");
    }
  };

  const handleServerApprovalModeChange = (name: string, approvalMode: ApprovalMode) => {
    try {
      const nextConfig = parseConfigObject(configJsonRef.current);
      const servers = getServersContainer(nextConfig);
      const current = servers[name];

      if (!current || typeof current !== "object" || Array.isArray(current)) {
        throw new Error(`未找到 ${name} 的配置`);
      }

      servers[name] = {
        ...(current as Record<string, unknown>),
        approvalMode,
      };

      const nextJson = JSON.stringify(nextConfig, null, 2);
      cancelScheduledAutoRefresh();
      setConfigJson(nextJson);
      setConfigError(null);
      void refreshTools({ config: nextJson, force: true });
      void messageApi.success(`${name} 已切换为 ${approvalMode === "manual" ? "manual 审批" : "solo 自动执行"}`);
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : "更新 MCP 审批模式失败");
    }
  };

  const handleRefresh = async () => {
    const normalizedConfig = normalizeConfigForSync(configJson);
    if (normalizedConfig && normalizedConfig !== configJson) {
      setConfigJson(normalizedConfig);
    }

    await refreshTools({ config: normalizedConfig || configJson, force: true, showSuccess: true });
  };

  const handleAddRemoteServer = () => {
    const name = serverName.trim();
    const url = serverUrl.trim();
    if (!name || !url) {
      setRemoteFormError("请先填写 Server Name 和 Server URL");
      return;
    }

    try {
      const nextConfig = parseConfigObject(configJson);
      const servers = getServersContainer(nextConfig);
      servers[name] = {
        enabled: true,
        type: remoteTransport,
        url,
        approvalMode: remoteApprovalMode,
      };
      handleConfigChange(JSON.stringify(nextConfig, null, 2));
      setServerName("");
      setServerUrl("");
      setRemoteApprovalMode("solo");
      setRemoteFormError(null);
      void messageApi.success("远程服务已加入配置");
    } catch (e) {
      setRemoteFormError(e instanceof Error ? e.message : "当前 mcp.json 不是有效对象");
    }
  };

  const draft = parseDraftServers(configJson);

  return (
    <>
      {contextHolder}
      <div className="h-full">
        <Tabs
          className="h-full"
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: "remote-servers",
              label: "远程服务",
              children: (
                <div className="grid h-full grid-cols-1 gap-6">
                  <Card className="app-panel-strong" bodyStyle={{ padding: 20 }}>
                    <Title level={4} className="app-title !mb-2">
                      远程服务
                    </Title>
                    <Paragraph className="app-muted !mb-0">
                      填写服务名称、服务地址、传输方式和审批策略，把远程服务加入当前配置草稿。新加入的服务默认启用，审批策略默认 `solo`。
                    </Paragraph>
                    <div className="mt-5 flex flex-col gap-3">
                      <div className="flex flex-col gap-2">
                        <Text className="app-text text-sm font-medium">服务名称</Text>
                        <Input
                          value={serverName}
                          onChange={(event) => {
                            setServerName(event.target.value);
                            if (remoteFormError) setRemoteFormError(null);
                          }}
                          placeholder="mcp-server"
                          size="large"
                          className="app-input"
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Text className="app-text text-sm font-medium">服务地址</Text>
                        <Input
                          value={serverUrl}
                          onChange={(event) => {
                            setServerUrl(event.target.value);
                            if (remoteFormError) setRemoteFormError(null);
                          }}
                          placeholder="https://example.com/mcp-server"
                          size="large"
                          className="app-input"
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Text className="app-text text-sm font-medium">传输方式</Text>
                        <div className="flex flex-wrap items-center gap-4">
                          <Radio.Group
                            value={remoteTransport}
                            onChange={(event) => setRemoteTransport(event.target.value)}
                            optionType="default"
                          >
                            <Radio.Button value="streamableHttp">Streamable HTTP</Radio.Button>
                            <Radio.Button value="sse">SSE (Legacy)</Radio.Button>
                          </Radio.Group>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2">
                        <Text className="app-text text-sm font-medium">审批模式</Text>
                        <div className="flex flex-wrap items-center gap-4">
                          <Radio.Group
                            value={remoteApprovalMode}
                            onChange={(event) => setRemoteApprovalMode(event.target.value)}
                            optionType="default"
                          >
                            <Radio.Button value="solo">Solo</Radio.Button>
                            <Radio.Button value="manual">Manual</Radio.Button>
                          </Radio.Group>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <Button
                          type="primary"
                          size="large"
                          className="app-btn app-mcp-btn app-mcp-btn-primary"
                          onClick={handleAddRemoteServer}
                        >
                          添加服务
                        </Button>
                        <Button
                          size="large"
                          className="app-btn app-mcp-btn app-mcp-btn-secondary"
                          onClick={() => {
                            setServerName("");
                            setServerUrl("");
                            setRemoteFormError(null);
                          }}
                        >
                          清空
                        </Button>
                      </div>
                      {remoteFormError ? <Alert type="error" showIcon message={remoteFormError} /> : null}
                    </div>
                  </Card>
                </div>
              ),
            },
            {
              key: "configure",
              label: "配置编辑",
              children: (
                <div className="grid h-full grid-cols-1 gap-6">
                  <div className="flex min-h-0 flex-col gap-6">
                    <Card className="app-panel-strong" bodyStyle={{ padding: 20 }}>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                        <Title level={4} className="app-title !mb-0">
                          配置编辑
                        </Title>
                        <Tooltip title="刷新配置并重载工具">
                          <Button
                            type="primary"
                            shape="circle"
                            className="app-btn app-mcp-btn app-mcp-btn-icon app-mcp-refresh-btn"
                            loading={refreshing}
                            icon={<ReloadOutlined />}
                            onClick={() => void handleRefresh()}
                            aria-label="刷新配置并重载工具"
                          />
                        </Tooltip>
                      </div>
                      <Paragraph className="app-muted !mb-4">
                        直接编写 `mcp.json`。JSON 合法时会自动刷新当前配置和工具，也可以点击右上角手动刷新。
                      </Paragraph>
                      {configError ? <Alert className="!mb-4" type="error" showIcon message={configError} /> : null}
                      {overview.error ? <Alert className="!mb-4" type="warning" showIcon message={overview.error} /> : null}
                      {draft.error ? <Alert className="!mb-4" type="warning" showIcon message={draft.error} /> : null}
                      <TextArea
                        value={configJson}
                        onChange={(event) => handleConfigChange(event.target.value)}
                        placeholder={DETAILED_JSON_PLACEHOLDER}
                        autoSize={{ minRows: 14, maxRows: 24 }}
                        spellCheck={false}
                        className="app-code-editor app-input"
                      />
                    </Card>

                  <Card className="app-panel flex-1" bodyStyle={{ padding: 20 }}>
                    <Title level={4} className="app-title !mb-2">
                      已配置 MCP 服务
                    </Title>
                    <Paragraph className="app-muted !mb-4">
                        这里展示当前已配置的 MCP 服务。你可以分别控制服务是否启用，以及工具调用是 `manual` 审批还是 `solo` 自动执行。
                    </Paragraph>
                    {loading ? (
                      <div className="py-10 text-center">
                        <Text className="app-muted">加载中…</Text>
                      </div>
                    ) : overview.servers.length === 0 ? (
                      <Empty description="当前还没有已配置的 MCP 服务" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    ) : (
                      <Collapse
                        className="app-mcp-server-collapse"
                        ghost
                        expandIconPosition="end"
                        expandIcon={({ isActive }) => (
                          <span className={`app-mcp-expand-btn ${isActive ? "is-open" : ""}`}>
                            <CaretRightOutlined />
                          </span>
                        )}
                        items={overview.servers.map((server) => ({
                          key: server.name,
                          label: (
                            <div className="app-mcp-server-header pr-2">
                              <div className="app-mcp-server-main min-w-0">
                                <Text strong className="app-text block">
                                  {server.name}
                                </Text>
                                <Text className="app-muted block text-sm">{server.target}</Text>
                              </div>
                              <div className="app-mcp-server-tags">
                                <div className="app-mcp-server-controls">
                                  <div
                                    className="app-mcp-enable-toggle"
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    <Text className="app-muted app-mcp-enable-label">启用</Text>
                                    <Tooltip
                                      title={
                                        server.enabled
                                          ? "关闭后将保留配置，但不会连接该服务或加载工具"
                                          : "开启后会重新连接该服务并尝试加载工具"
                                      }
                                    >
                                      <Switch
                                        size="small"
                                        checked={server.enabled}
                                        loading={refreshing}
                                        aria-label={`切换 ${server.name} 的启用状态`}
                                        onChange={(checked) => handleServerEnabledChange(server.name, checked)}
                                      />
                                    </Tooltip>
                                  </div>
                                  <div
                                    className="app-mcp-enable-toggle"
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    <Text className="app-muted app-mcp-enable-label">审批</Text>
                                    <Tooltip
                                      title={
                                        server.approvalMode === "manual"
                                          ? "手动审批：工具调用需确认后执行"
                                          : "自动执行：工具调用将直接执行"
                                      }
                                    >
                                      <Switch
                                        size="small"
                                        checked={server.approvalMode === "manual"}
                                        loading={refreshing}
                                        aria-label={`切换 ${server.name} 的审批模式`}
                                        onChange={(checked) =>
                                          handleServerApprovalModeChange(server.name, checked ? "manual" : "solo")
                                        }
                                      />
                                    </Tooltip>
                                  </div>
                                </div>
                                <McpOverflowTags
                                  items={[
                                    {
                                      key: `${server.name}:status`,
                                      className: `app-mcp-chip-status ${getStatusClassName(server.status)}`,
                                      label: getStatusLabel(server.status),
                                    },
                                    {
                                      key: `${server.name}:transport`,
                                      className: "app-mcp-chip-transport",
                                      label: server.transport,
                                    },
                                    {
                                      key: `${server.name}:tool-count`,
                                      className: "app-mcp-chip-count",
                                      label: `${server.toolCount} 个工具`,
                                    },
                                  ]}
                                />
                              </div>
                            </div>
                          ),
                          children: (
                            <div className="app-mcp-server-tools flex flex-col gap-3 pb-2 pt-1">
                              {!server.enabled ? (
                                <Text className="app-muted text-sm">当前服务已停用，重新启用后才会尝试连接并加载工具。</Text>
                              ) : server.tools.length === 0 ? (
                                <Text className="app-muted text-sm">当前服务还没有加载到可用工具。</Text>
                              ) : (
                                server.tools.map((tool) => (
                                  <div
                                    key={`${server.name}:${tool.name}`}
                                    className="app-mcp-server-tool rounded-2xl border border-[var(--app-panel-border)] px-4 py-3"
                                  >
                                    <Text strong className="app-text !font-mono">
                                      {tool.name}
                                    </Text>
                                    <Paragraph className="app-muted !mb-0 !mt-2 !text-sm">
                                      {tool.description || "无描述"}
                                    </Paragraph>
                                  </div>
                                ))
                              )}
                            </div>
                          ),
                        }))}
                      />
                    )}
                  </Card>

                  </div>
                </div>
              ),
            },
          ]}
        />
      </div>
    </>
  );
}

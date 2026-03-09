import { useEffect, useMemo, useState } from "react";
import { App as AntApp, ConfigProvider, Grid, Layout, Spin, theme } from "antd";
import { fetchMcpOverview, fetchModels } from "./api";
import Dock, { type DockTab } from "./Dock";
import McpView from "./McpView";
import PromptsView from "./PromptsView";
import SessionView from "./SessionView";
import { getStoredTheme, readStoredPrompt, storePrompt, storeTheme, type ThemeMode } from "./theme";

const { Content, Sider } = Layout;
const LEGACY_DEFAULT_PROMPT = "你是一个有帮助的AI助手，用简洁清晰的方式回答用户问题。";
const SERVER_REACT_PROMPT =
  "你是一个擅长解决问题的 AI 助手。请使用简洁的 ReAct 风格工作：先理解目标，再判断是否需要行动；如果问题可以通过 MCP 工具获得更可靠的信息或直接完成操作，优先调用 MCP；拿到结果后再用简洁清晰的中文给出答案，不要暴露冗长的内部推理。";
const DEFAULT_SYSTEM_PROMPT = `你是一个擅长解决问题的 AI 助手。

请使用简洁的 ReAct 风格工作：
1. 先理解用户目标。
2. 判断是否需要调用工具。
3. 如果 MCP 工具能提供更可靠的信息或能直接完成操作，优先调用 MCP。
4. 基于工具结果或已有信息，给出简洁清晰的中文答复。

不要暴露冗长的内部推理，只输出对用户有帮助的结果。`;

export default function App() {
  const screens = Grid.useBreakpoint();
  const [dockTab, setDockTab] = useState<DockTab>("session");
  const [modelId, setModelId] = useState("");
  const [currentPromptText, setCurrentPromptText] = useState(() => readStoredPrompt() || DEFAULT_SYSTEM_PROMPT);
  const [mcpCount, setMcpCount] = useState(0);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredTheme());
  const [loading, setLoading] = useState(true);

  const getMcpToolCount = (overview: Awaited<ReturnType<typeof fetchMcpOverview>>) =>
    overview.servers.reduce((total, server) => total + server.toolCount, 0);

  useEffect(() => {
    Promise.all([fetchModels(), fetchMcpOverview()])
      .then(([modelsResponse, mcpOverview]) => {
        const defaultModel =
          modelsResponse.models.find((model) => model.id === modelsResponse.defaultModelId) ?? modelsResponse.models[0];

        setModelId(defaultModel?.id ?? "");
        setCurrentPromptText((prev) =>
          !prev || prev === LEGACY_DEFAULT_PROMPT || prev === SERVER_REACT_PROMPT ? DEFAULT_SYSTEM_PROMPT : prev
        );
        setMcpCount(getMcpToolCount(mcpOverview));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    storeTheme(themeMode);
  }, [themeMode]);

  useEffect(() => {
    storePrompt(currentPromptText);
  }, [currentPromptText]);

  const isDark = themeMode === "dark";
  const isMobile = !screens.md;

  const themeConfig = useMemo(
    () => ({
      algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
      token: {
        colorPrimary: isDark ? "#d1793f" : "#c45c1b",
        borderRadius: 16,
        colorBgBase: isDark ? "#121313" : "#fbf8f2",
        colorBgContainer: isDark ? "rgba(43, 38, 34, 0.93)" : "rgba(255, 255, 252, 0.98)",
        colorBorder: isDark ? "rgba(158, 140, 119, 0.32)" : "rgba(87, 96, 110, 0.2)",
      },
    }),
    [isDark]
  );

  return (
    <ConfigProvider theme={themeConfig}>
      <AntApp>
        <Layout className="min-h-dvh !bg-transparent p-4 md:p-6">
          <div className="app-shell flex h-[calc(100dvh-2rem)] min-h-0 w-full overflow-hidden rounded-[28px] md:h-[calc(100dvh-3rem)]">
            {!isMobile ? (
              <Sider width={96} theme={isDark ? "dark" : "light"} className="!bg-transparent">
                <Dock
                  active={dockTab}
                  onSelect={setDockTab}
                  mcpCount={mcpCount}
                  themeMode={themeMode}
                  onSetTheme={setThemeMode}
                />
              </Sider>
            ) : null}
            <Layout className="min-h-0 !bg-transparent">
              <Content className="app-scroll min-h-0 min-w-0 overflow-y-auto !bg-transparent p-3 md:p-6">
                {loading ? (
                  <div className="flex h-full items-center justify-center">
                    <Spin size="large" />
                  </div>
                ) : dockTab === "session" ? (
                  <SessionView modelId={modelId} currentPromptText={currentPromptText} />
                ) : dockTab === "prompts" ? (
                  <PromptsView currentPromptText={currentPromptText} onChangePromptText={setCurrentPromptText} />
                ) : (
                  <McpView onToolsChange={setMcpCount} />
                )}
              </Content>
              {isMobile ? (
                <div className="p-3 pt-0">
                  <Dock
                    mobile
                    active={dockTab}
                    onSelect={setDockTab}
                    mcpCount={mcpCount}
                    themeMode={themeMode}
                    onSetTheme={setThemeMode}
                  />
                </div>
              ) : null}
            </Layout>
          </div>
        </Layout>
      </AntApp>
    </ConfigProvider>
  );
}

import { ApiOutlined, FileTextOutlined, MessageOutlined, MoonOutlined, RobotOutlined, SunOutlined } from "@ant-design/icons";
import { Badge, Button, Tooltip } from "antd";
import type { ReactNode } from "react";
import type { ThemeMode } from "./theme";

export type DockTab = "session" | "prompts" | "mcp";

interface DockProps {
  active: DockTab;
  onSelect: (tab: DockTab) => void;
  mcpCount?: number;
  themeMode: ThemeMode;
  onSetTheme: (mode: ThemeMode) => void;
  mobile?: boolean;
}

export default function Dock({ active, onSelect, mcpCount = 0, themeMode, onSetTheme, mobile = false }: DockProps) {
  const isDark = themeMode === "dark";
  const mcpIcon = (
    <Badge count={mcpCount} size="small" offset={[4, -2]}>
      <ApiOutlined className="text-lg text-inherit" />
    </Badge>
  );
  const navItems: Array<{ key: DockTab; label: string; icon: ReactNode }> = [
    { key: "session", label: "会话", icon: <MessageOutlined className="text-lg" /> },
    { key: "prompts", label: "提示词", icon: <FileTextOutlined className="text-lg" /> },
    { key: "mcp", label: "MCP", icon: mcpIcon },
  ];

  if (mobile) {
    return (
      <div className="app-sider grid grid-cols-4 gap-2 rounded-2xl p-2">
        {navItems.map((item) => (
          <Button
            key={item.key}
            type={active === item.key ? "primary" : "text"}
            className="app-btn !h-auto !px-2 !py-2"
            icon={item.icon}
            onClick={() => onSelect(item.key)}
          >
            {item.label}
          </Button>
        ))}
        <Button
          type="text"
          className="app-btn !h-auto !px-2 !py-2"
          icon={isDark ? <MoonOutlined /> : <SunOutlined />}
          onClick={() => onSetTheme(isDark ? "light" : "dark")}
        >
          {isDark ? "深色" : "浅色"}
        </Button>
      </div>
    );
  }

  return (
    <div className="app-sider flex h-full flex-col gap-4 px-3 py-4">
      <div className="app-panel flex items-center justify-center rounded-2xl px-2 py-3 text-center">
        <RobotOutlined className="app-text text-lg" aria-label="助手导航" />
      </div>
      <div className="flex flex-1 flex-col items-center gap-3">
        {navItems.map((item) => (
          <Tooltip key={item.key} placement="right" title={item.label}>
            <button
              type="button"
              aria-label={item.label}
              className={`app-dock-icon-btn ${active === item.key ? "is-active" : ""}`}
              onClick={() => onSelect(item.key)}
            >
              {item.icon}
            </button>
          </Tooltip>
        ))}
      </div>
      <div className="flex justify-center">
        <Tooltip placement="right" title={isDark ? "切换到浅色模式" : "切换到深色模式"}>
          <button
            type="button"
            aria-label={isDark ? "切换到浅色模式" : "切换到深色模式"}
            className={`app-dock-icon-btn app-dock-theme-btn ${isDark ? "is-active" : ""}`}
            onClick={() => onSetTheme(isDark ? "light" : "dark")}
          >
            {isDark ? <SunOutlined className="text-lg" /> : <MoonOutlined className="text-lg" />}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { Connection } from "@langchain/mcp-adapters";
import type { StructuredToolInterface } from "@langchain/core/tools";

let cachedTools: StructuredToolInterface[] | null = null;
let cachedToolBindings: McpToolBinding[] | null = null;
let cachedToolsByServer: Record<string, McpToolBinding[]> | null = null;
let lastMcpLoadError: string | null = null;
/** 内存中的 MCP 配置（JSON 字符串），优先于环境变量 */
let inMemoryMcpJson: string | null = null;

export type McpApprovalMode = "manual" | "solo";

export function getMcpConfigJson(): string {
  return inMemoryMcpJson ?? process.env.MCP_SERVERS ?? "";
}

export function setMcpConfigFromJson(json: string): void {
  const trimmed = json?.trim() || "";
  inMemoryMcpJson = trimmed ? trimmed : null;
  clearMcpCache();
}

/** 将 JSON 字符串解析为 mcpServers 对象 */
type McpServerStdio = {
  enabled?: boolean;
  approvalMode?: McpApprovalMode;
  transport?: "stdio";
  type?: "stdio";
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
};
type McpServerRemoteRaw = {
  enabled?: boolean;
  approvalMode?: McpApprovalMode;
  transport?: "http" | "sse" | "streamableHttp";
  type?: "http" | "sse" | "streamableHttp";
  url: string;
  headers?: Record<string, string>;
};
type McpServerRemote = {
  approvalMode?: McpApprovalMode;
  transport?: "http" | "sse";
  type?: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
};
type McpServerEntryRaw = McpServerStdio | McpServerRemoteRaw;
export type McpServerEntry = McpServerStdio | McpServerRemote;

export interface McpToolSummary {
  name: string;
  description: string;
}

export interface McpToolBinding {
  bindingName: string;
  toolName: string;
  description: string;
  serverName: string;
  approvalMode: McpApprovalMode;
  tool: StructuredToolInterface;
}

export interface McpServerSummary {
  name: string;
  enabled: boolean;
  approvalMode: McpApprovalMode;
  transport: "stdio" | "sse" | "streamableHttp";
  target: string;
  status: "configured" | "ready" | "error" | "disabled";
  toolCount: number;
  tools: McpToolSummary[];
}

function normalizeTransport(value: unknown): "stdio" | "sse" | "streamableHttp" {
  if (value === "stdio") return "stdio";
  if (value === "sse") return "sse";
  return "streamableHttp";
}

function normalizeRemoteTransport(value: unknown): "sse" | "http" {
  return value === "sse" ? "sse" : "http";
}

function normalizeEnabled(value: unknown): boolean {
  return value !== false;
}

function normalizeApprovalMode(value: unknown): McpApprovalMode {
  return value === "manual" ? "manual" : "solo";
}

function extractServersRoot(parsed: Record<string, unknown>): Record<string, unknown> {
  const scoped = parsed.mcpServers;
  if (scoped && typeof scoped === "object" && !Array.isArray(scoped)) {
    return scoped as Record<string, unknown>;
  }
  return parsed;
}

function parseRawMcpConfig(raw: string): Record<string, McpServerEntryRaw> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const serverEntries = extractServersRoot(parsed);
    const out: Record<string, McpServerEntryRaw> = {};
    for (const [name, cfg] of Object.entries(serverEntries)) {
      if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) continue;
      const c = cfg as Record<string, unknown>;
      const transport = c.transport ?? c.type;
      if ((transport === "stdio" || (transport === undefined && typeof c.command === "string")) && typeof c.command === "string") {
        out[name] = {
          enabled: normalizeEnabled(c.enabled),
          approvalMode: normalizeApprovalMode(c.approvalMode),
          transport: "stdio",
          command: c.command,
          args: Array.isArray(c.args) ? c.args.filter((arg): arg is string => typeof arg === "string") : [],
          cwd: typeof c.cwd === "string" ? c.cwd : undefined,
          env:
            c.env && typeof c.env === "object" && !Array.isArray(c.env)
              ? Object.fromEntries(
                  Object.entries(c.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
                )
              : undefined,
        };
      } else if (
        (transport === "sse" || transport === "http" || transport === "streamableHttp" || transport === undefined) &&
        typeof c.url === "string"
      ) {
        out[name] = {
          enabled: normalizeEnabled(c.enabled),
          approvalMode: normalizeApprovalMode(c.approvalMode),
          transport: normalizeRemoteTransport(transport),
          url: c.url,
          headers:
            c.headers && typeof c.headers === "object" && !Array.isArray(c.headers)
              ? Object.fromEntries(
                  Object.entries(c.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string")
                )
              : undefined,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function parseMcpConfig(raw: string): Record<string, McpServerEntry> {
  const parsed = parseRawMcpConfig(raw);
  const out: Record<string, McpServerEntry> = {};
  for (const [name, entry] of Object.entries(parsed)) {
    if (entry.enabled === false) {
      continue;
    }
    if ("command" in entry) {
      out[name] = {
        approvalMode: normalizeApprovalMode(entry.approvalMode),
        transport: "stdio",
        command: entry.command,
        args: entry.args,
        cwd: entry.cwd,
        env: entry.env,
      };
      continue;
    }
    out[name] = {
      approvalMode: normalizeApprovalMode(entry.approvalMode),
      transport: normalizeRemoteTransport(entry.transport ?? entry.type),
      url: entry.url,
      headers: entry.headers,
    };
  }
  return out;
}

function getMcpConfig(): Record<string, McpServerEntry> {
  const raw = inMemoryMcpJson ?? process.env.MCP_SERVERS ?? "";
  return parseMcpConfig(raw);
}

function toClientConnections(config: Record<string, McpServerEntry>): Record<string, Connection> {
  return Object.fromEntries(
    Object.entries(config).map(([name, entry]) => {
      if ("command" in entry) {
        return [
          name,
          {
            transport: "stdio",
            command: entry.command,
            args: entry.args,
            env: entry.env,
          } satisfies Connection,
        ];
      }

      // mcp-adapters 0.3.x only understands SSE for remote transports.
      // Keep accepting streamableHttp in config/UI, and downcast it here.
      return [
        name,
        {
          transport: "sse",
          url: entry.url,
          headers: entry.headers,
        } satisfies Connection,
      ];
    })
  );
}

function toBindingToolSummary(binding: McpToolBinding): McpToolSummary {
  return {
    name: binding.toolName,
    description: binding.description,
  };
}

function sanitizeBindingSegment(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
  return normalized || "tool";
}

function createBindingName(serverName: string, toolName: string): string {
  return `mcp_${sanitizeBindingSegment(serverName)}__${sanitizeBindingSegment(toolName)}`;
}

function wrapTool(tool: StructuredToolInterface, bindingName: string, description: string): StructuredToolInterface {
  const wrapped = Object.create(tool) as StructuredToolInterface;
  Object.defineProperty(wrapped, "name", {
    value: bindingName,
    enumerable: true,
    configurable: true,
    writable: false,
  });
  Object.defineProperty(wrapped, "description", {
    value: description,
    enumerable: true,
    configurable: true,
    writable: false,
  });
  return wrapped;
}

export function getMcpServersSummary(): McpServerSummary[] {
  const rawConfig = parseRawMcpConfig(getMcpConfigJson());
  return Object.entries(rawConfig).map(([name, entry]) => {
    const enabled = normalizeEnabled(entry.enabled);
    const status: McpServerSummary["status"] = !enabled
      ? "disabled"
      : lastMcpLoadError
        ? "error"
        : cachedTools !== null
          ? "ready"
          : "configured";
    const tools = enabled ? (cachedToolsByServer?.[name] ?? []).map(toBindingToolSummary) : [];
    if ("command" in entry) {
      return {
        name,
        enabled,
        approvalMode: normalizeApprovalMode(entry.approvalMode),
        transport: "stdio",
        target: [entry.command, ...entry.args].join(" ").trim(),
        status,
        toolCount: tools.length,
        tools,
      };
    }
    const transport = normalizeTransport(entry.transport ?? entry.type);
    return {
      name,
      enabled,
      approvalMode: normalizeApprovalMode(entry.approvalMode),
      transport,
      target: entry.url,
      status,
      toolCount: tools.length,
      tools,
    };
  });
}

export function getLastMcpLoadError(): string | null {
  return lastMcpLoadError;
}

export async function loadMcpToolBindings(): Promise<McpToolBinding[]> {
  if (cachedToolBindings !== null) return cachedToolBindings;
  const config = getMcpConfig();
  if (Object.keys(config).length === 0) {
    cachedToolBindings = [];
    cachedTools = [];
    cachedToolsByServer = {};
    lastMcpLoadError = null;
    return cachedToolBindings;
  }
  try {
    const client = new MultiServerMCPClient(toClientConnections(config));
    const toolsByServer = Object.fromEntries(await client.initializeConnections()) as Record<string, StructuredToolInterface[]>;
    const bindingsByServer = Object.fromEntries(
      Object.entries(toolsByServer).map(([serverName, tools]) => {
        const approvalMode = config[serverName]?.approvalMode ?? "solo";
        return [
          serverName,
          tools.map((tool) => {
            const description = [tool.description?.trim(), `MCP server: ${serverName}`].filter(Boolean).join("\n\n");
            return {
              bindingName: createBindingName(serverName, tool.name),
              toolName: tool.name,
              description: tool.description,
              serverName,
              approvalMode,
              tool: wrapTool(tool, createBindingName(serverName, tool.name), description),
            } satisfies McpToolBinding;
          }),
        ];
      })
    ) as Record<string, McpToolBinding[]>;
    const toolBindings = Object.values(bindingsByServer).flat();
    cachedToolBindings = toolBindings;
    cachedTools = toolBindings.map((binding) => binding.tool);
    cachedToolsByServer = bindingsByServer;
    lastMcpLoadError = null;
    return toolBindings;
  } catch (err) {
    console.warn("MCP tools load failed:", err);
    cachedToolBindings = [];
    cachedTools = [];
    cachedToolsByServer = {};
    lastMcpLoadError = err instanceof Error ? err.message : "MCP tools load failed";
    return [];
  }
}

export async function loadMcpTools(): Promise<StructuredToolInterface[]> {
  if (cachedTools !== null) return cachedTools;
  const bindings = await loadMcpToolBindings();
  return bindings.map((binding) => binding.tool);
}

export function clearMcpCache(): void {
  cachedToolBindings = null;
  cachedTools = null;
  cachedToolsByServer = null;
  lastMcpLoadError = null;
}

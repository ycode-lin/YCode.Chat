const API = "/api";

export type ApprovalMode = "manual" | "solo";
export type PendingRunState = "awaiting_decision" | "ready_to_resume" | "resuming";
export type PendingRunDecision = "approve" | "deny";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ModelOption {
  id: string;
  name: string;
  provider: string;
  model: string;
}

export interface ModelsResponse {
  models: ModelOption[];
  defaultModelId?: string;
}

export interface PromptTemplate {
  id: string;
  name: string;
  systemPrompt: string;
}

export interface McpTool {
  name: string;
  description: string;
  serverName?: string;
  approvalMode?: ApprovalMode;
}

export interface McpServerSummary {
  name: string;
  enabled: boolean;
  approvalMode: ApprovalMode;
  transport: "stdio" | "sse" | "streamableHttp";
  target: string;
  status: "configured" | "ready" | "error" | "disabled";
  toolCount: number;
  tools: McpTool[];
}

export interface PendingToolApproval {
  toolCallId: string;
  bindingName: string;
  toolName: string;
  serverName: string;
  input: unknown;
  approvalMode: ApprovalMode;
  requestedAt: string;
  decision?: PendingRunDecision;
  decidedAt?: string;
}

export interface PendingRunSummary {
  runId: string;
  sessionId: string;
  messageId: string;
  modelId: string;
  state: PendingRunState;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  pendingTool: PendingToolApproval;
}

export interface McpOverview {
  config: string;
  servers: McpServerSummary[];
  tools: McpTool[];
  error: string | null;
}

export async function fetchModels(): Promise<ModelsResponse> {
  const res = await fetch(`${API}/models`);
  if (!res.ok) throw new Error("Failed to fetch models");
  return (await res.json()) as ModelsResponse;
}

export async function fetchPrompts(): Promise<PromptTemplate[]> {
  const res = await fetch(`${API}/prompts`);
  if (!res.ok) throw new Error("Failed to fetch prompts");
  const data = await res.json();
  return data.prompts;
}

export async function fetchMcpConfig(): Promise<string> {
  const res = await fetch(`${API}/mcp/config`);
  if (!res.ok) return "";
  const data = await res.json();
  return data.config ?? "";
}

export async function setMcpConfig(config: string): Promise<void> {
  const res = await fetch(`${API}/mcp/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config }),
  });
  if (!res.ok) throw new Error("设置 MCP 配置失败");
}

export async function fetchMcpTools(): Promise<McpTool[]> {
  const res = await fetch(`${API}/mcp/tools`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.tools ?? [];
}

export async function fetchMcpOverview(): Promise<McpOverview> {
  const res = await fetch(`${API}/mcp/overview`);
  if (!res.ok) {
    return {
      config: "",
      servers: [],
      tools: [],
      error: "加载 MCP 概览失败",
    };
  }
  return (await res.json()) as McpOverview;
}

export async function reloadMcpTools(): Promise<void> {
  await fetch(`${API}/mcp/reload`, { method: "POST" });
}

export async function fetchPendingRuns(sessionId: string): Promise<PendingRunSummary[]> {
  const query = new URLSearchParams({ sessionId });
  const res = await fetch(`${API}/chat/pending?${query.toString()}`);
  if (!res.ok) {
    throw new Error("加载待审批列表失败");
  }
  const data = (await res.json()) as { runs?: PendingRunSummary[] };
  return data.runs ?? [];
}

export async function submitToolApprovalDecision(
  runId: string,
  toolCallId: string,
  decision: PendingRunDecision
): Promise<PendingRunSummary> {
  const res = await fetch(`${API}/chat/runs/${encodeURIComponent(runId)}/tool-calls/${encodeURIComponent(toolCallId)}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "提交审批结果失败");
  }
  const data = (await res.json()) as { run: PendingRunSummary };
  return data.run;
}

export interface ChatOptions {
  modelId: string;
  promptId?: string;
  systemPrompt?: string;
}

export async function sendChat(
  messages: ChatMessage[],
  options: ChatOptions
): Promise<ChatMessage> {
  const res = await fetch(`${API}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      modelId: options.modelId,
      promptId: options.promptId,
      systemPrompt: options.systemPrompt,
      stream: false,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Chat request failed");
  }
  const data = await res.json();
  return data.message;
}

export async function* streamChat(
  messages: ChatMessage[],
  options: ChatOptions
): AsyncGenerator<string> {
  const res = await fetch(`${API}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      modelId: options.modelId,
      promptId: options.promptId,
      systemPrompt: options.systemPrompt,
      stream: true,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Chat request failed");
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const payload = line.slice(6);
        if (payload === "[DONE]") return;
        try {
          const obj = JSON.parse(payload);
          if (obj.text) yield obj.text;
        } catch {
          // ignore
        }
      }
    }
  }
}

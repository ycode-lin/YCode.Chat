import type { BaseMessage } from "@langchain/core/messages";
import type { ProviderOverrides } from "./createModel.js";
import type { McpApprovalMode } from "../mcp/loadTools.js";

const PENDING_RUN_TTL_MS = 30 * 60 * 1000;

export type PendingRunDecision = "approve" | "deny";
export type PendingRunState = "awaiting_decision" | "ready_to_resume" | "resuming";

export type DeepSeekToolMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_call_id?: string;
  reasoning_content?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
};

interface PendingToolApprovalBase {
  toolCallId: string;
  bindingName: string;
  toolName: string;
  serverName: string;
  input: unknown;
  approvalMode: McpApprovalMode;
  requestedAt: string;
  decision?: PendingRunDecision;
  decidedAt?: string;
}

export interface StandardPendingRunRecord {
  kind: "standard";
  runId: string;
  sessionId: string;
  messageId: string;
  modelId: string;
  systemPrompt?: string;
  providerOverrides?: ProviderOverrides;
  workingMessages: BaseMessage[];
  pendingTool: PendingToolApprovalBase;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  state: PendingRunState;
}

export interface DeepSeekPendingRunRecord {
  kind: "deepseek";
  runId: string;
  sessionId: string;
  messageId: string;
  modelId: string;
  systemPrompt?: string;
  providerOverrides?: ProviderOverrides;
  workingMessages: DeepSeekToolMessage[];
  pendingTool: PendingToolApprovalBase & {
    rawArguments?: string;
  };
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  state: PendingRunState;
}

export type PendingRunRecord = StandardPendingRunRecord | DeepSeekPendingRunRecord;
type StandardPendingRunInput = Omit<StandardPendingRunRecord, "createdAt" | "updatedAt" | "expiresAt" | "state">;
type DeepSeekPendingRunInput = Omit<DeepSeekPendingRunRecord, "createdAt" | "updatedAt" | "expiresAt" | "state">;
type PendingRunInput = StandardPendingRunInput | DeepSeekPendingRunInput;

export interface PendingRunSummary {
  runId: string;
  sessionId: string;
  messageId: string;
  modelId: string;
  state: PendingRunState;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  pendingTool: PendingRunRecord["pendingTool"];
}

const pendingRuns = new Map<string, PendingRunRecord>();

function nowIso(): string {
  return new Date().toISOString();
}

function nextExpiryIso(): string {
  return new Date(Date.now() + PENDING_RUN_TTL_MS).toISOString();
}

function isExpired(record: PendingRunRecord): boolean {
  return Date.parse(record.expiresAt) <= Date.now();
}

function cleanupExpiredRuns(): void {
  for (const [runId, record] of pendingRuns.entries()) {
    if (isExpired(record)) {
      pendingRuns.delete(runId);
    }
  }
}

function toSummary(record: PendingRunRecord): PendingRunSummary {
  return {
    runId: record.runId,
    sessionId: record.sessionId,
    messageId: record.messageId,
    modelId: record.modelId,
    state: record.state,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
    pendingTool: record.pendingTool,
  };
}

export function savePendingRun(record: StandardPendingRunInput): StandardPendingRunRecord;
export function savePendingRun(record: DeepSeekPendingRunInput): DeepSeekPendingRunRecord;
export function savePendingRun(record: PendingRunInput): PendingRunRecord {
  cleanupExpiredRuns();
  const timestamp = nowIso();
  if (record.kind === "deepseek") {
    const nextRecord: DeepSeekPendingRunRecord = {
      ...record,
      kind: "deepseek",
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: nextExpiryIso(),
      state: "awaiting_decision",
    };
    pendingRuns.set(record.runId, nextRecord);
    return nextRecord;
  }

  const nextRecord: StandardPendingRunRecord = {
    ...record,
    kind: "standard",
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: nextExpiryIso(),
    state: "awaiting_decision",
  };
  pendingRuns.set(record.runId, nextRecord);
  return nextRecord;
}

export function listPendingRuns(sessionId?: string): PendingRunSummary[] {
  cleanupExpiredRuns();
  return [...pendingRuns.values()]
    .filter((record) => (sessionId ? record.sessionId === sessionId : true))
    .map(toSummary)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function getPendingRun(runId: string): PendingRunRecord | null {
  cleanupExpiredRuns();
  return pendingRuns.get(runId) ?? null;
}

export function resolvePendingRun(runId: string, toolCallId: string, decision: PendingRunDecision): PendingRunRecord {
  cleanupExpiredRuns();
  const record = pendingRuns.get(runId);
  if (!record) {
    throw new Error(`Pending run not found: ${runId}`);
  }
  if (record.pendingTool.toolCallId !== toolCallId) {
    throw new Error(`Pending tool call not found: ${toolCallId}`);
  }
  const updatedRecord: PendingRunRecord = {
    ...record,
    state: "ready_to_resume",
    updatedAt: nowIso(),
    expiresAt: nextExpiryIso(),
    pendingTool: {
      ...record.pendingTool,
      decision,
      decidedAt: nowIso(),
    },
  };
  pendingRuns.set(runId, updatedRecord);
  return updatedRecord;
}

export function beginPendingRunResume(runId: string): PendingRunRecord {
  cleanupExpiredRuns();
  const record = pendingRuns.get(runId);
  if (!record) {
    throw new Error(`Pending run not found: ${runId}`);
  }
  if (record.state !== "ready_to_resume") {
    throw new Error(`Pending run is not ready to resume: ${runId}`);
  }
  if (!record.pendingTool.decision) {
    throw new Error(`Pending run decision missing: ${runId}`);
  }
  const updatedRecord: PendingRunRecord = {
    ...record,
    state: "resuming",
    updatedAt: nowIso(),
    expiresAt: nextExpiryIso(),
  };
  pendingRuns.set(runId, updatedRecord);
  return updatedRecord;
}

export function restorePendingRun(runId: string): PendingRunRecord {
  cleanupExpiredRuns();
  const record = pendingRuns.get(runId);
  if (!record) {
    throw new Error(`Pending run not found: ${runId}`);
  }
  const updatedRecord: PendingRunRecord = {
    ...record,
    state: "ready_to_resume",
    updatedAt: nowIso(),
    expiresAt: nextExpiryIso(),
  };
  pendingRuns.set(runId, updatedRecord);
  return updatedRecord;
}

export function deletePendingRun(runId: string): void {
  pendingRuns.delete(runId);
}

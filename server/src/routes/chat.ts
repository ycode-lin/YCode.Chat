import { Router, type Response } from "express";
import { runChat, resumeChatEvents, streamChatEvents } from "../llm/chat.js";
import { formatSseEvent, type ChatStreamEvent } from "../llm/chatEvents.js";
import { loadMcpToolBindings } from "../mcp/loadTools.js";
import { getDefaultModelId } from "../config/llm.js";
import { BUILTIN_PROMPTS } from "../config/prompts.js";
import { getPendingRun, listPendingRuns, resolvePendingRun } from "../llm/pendingRuns.js";

export const chatRouter = Router();

function getSystemPrompt(body: {
  systemPrompt?: string;
  promptId?: string;
}): string | undefined {
  if (typeof body.systemPrompt === "string") return body.systemPrompt.trim();
  if (body.promptId) {
    const p = BUILTIN_PROMPTS.find((x) => x.id === body.promptId);
    if (p) return p.systemPrompt;
  }
  return BUILTIN_PROMPTS[0]?.systemPrompt;
}

function getProviderOverrides(body: Record<string, unknown>): {
  openaiApiKey?: string;
  openaiBaseURL?: string;
} | undefined {
  const o = body.providerOverrides as Record<string, unknown> | undefined;
  if (!o || typeof o !== "object") return undefined;
  const out: { openaiApiKey?: string; openaiBaseURL?: string } = {};
  if (typeof o.openaiApiKey === "string") out.openaiApiKey = o.openaiApiKey;
  if (typeof o.openaiBaseURL === "string") out.openaiBaseURL = o.openaiBaseURL;
  if (Object.keys(out).length === 0) return undefined;
  return out;
}

function getSessionId(body: Record<string, unknown>): string {
  return typeof body.sessionId === "string" && body.sessionId.trim() ? body.sessionId.trim() : "default";
}

function writeSseHeaders(res: Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

async function writeEventStream(
  res: Response,
  events: AsyncIterable<ChatStreamEvent>
) {
  writeSseHeaders(res);
  for await (const event of events) {
    res.write(formatSseEvent(event));
  }
  res.end();
}

chatRouter.get("/pending", (req, res) => {
  const sessionId = typeof req.query.sessionId === "string" && req.query.sessionId.trim() ? req.query.sessionId.trim() : undefined;
  res.json({ runs: listPendingRuns(sessionId) });
});

chatRouter.post("/runs/:runId/tool-calls/:toolCallId/decision", (req, res) => {
  const decision = req.body?.decision;
  if (decision !== "approve" && decision !== "deny") {
    res.status(400).json({ error: "decision must be approve or deny" });
    return;
  }

  try {
    const run = resolvePendingRun(req.params.runId, req.params.toolCallId, decision);
    res.json({
      ok: true,
      run: {
        runId: run.runId,
        sessionId: run.sessionId,
        messageId: run.messageId,
        modelId: run.modelId,
        state: run.state,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        expiresAt: run.expiresAt,
        pendingTool: run.pendingTool,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resolve pending tool call";
    const status = message.includes("not found") ? 404 : 409;
    res.status(status).json({ error: message });
  }
});

chatRouter.post("/runs/:runId/resume", async (req, res) => {
  const runId = req.params.runId;
  const pendingRun = getPendingRun(runId);

  if (!pendingRun) {
    res.status(404).json({ error: "Pending run not found" });
    return;
  }

  if (pendingRun.state !== "ready_to_resume") {
    res.status(409).json({ error: "Pending run is not ready to resume" });
    return;
  }

  try {
    await writeEventStream(res, resumeChatEvents(runId));
  } catch (error) {
    console.error("Resume chat error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Resume failed",
      });
    } else {
      res.end();
    }
  }
});

chatRouter.post("/", async (req, res) => {
  try {
    const { messages, stream: wantStream } = req.body as {
      messages: { role: string; content: string }[];
      modelId?: string;
      stream?: boolean;
    };

    if (!Array.isArray(messages) || !messages.length) {
      res.status(400).json({ error: "messages is required and non-empty" });
      return;
    }

    const modelId: string = (req.body as { modelId?: string }).modelId ?? getDefaultModelId();
    const sessionId = getSessionId(req.body as Record<string, unknown>);

    const systemPrompt = getSystemPrompt(req.body);
    const toolBindings = await loadMcpToolBindings();
    const providerOverrides = getProviderOverrides(req.body);

    console.log("[chat] bound MCP tools", {
      count: toolBindings.length,
      names: toolBindings.map((tool) => `${tool.serverName}:${tool.toolName}`),
      modelId,
      sessionId,
    });

    if (wantStream) {
      await writeEventStream(res, streamChatEvents({
        sessionId,
        messages: messages as { role: "user" | "assistant" | "system"; content: string }[],
        modelId,
        systemPrompt: systemPrompt ?? undefined,
        promptTemplates: BUILTIN_PROMPTS,
        tools: toolBindings.length > 0 ? toolBindings : undefined,
        providerOverrides,
      }));
      return;
    }

    const hasManualApproval = toolBindings.some((binding) => binding.approvalMode === "manual");
    if (hasManualApproval) {
      res.status(400).json({
        error: "Manual MCP approval requires stream mode",
      });
      return;
    }

    const reply = await runChat({
      sessionId,
      messages: messages as { role: "user" | "assistant" | "system"; content: string }[],
      modelId,
      systemPrompt: systemPrompt ?? undefined,
      promptTemplates: BUILTIN_PROMPTS,
      tools: toolBindings.length > 0 ? toolBindings : undefined,
      providerOverrides,
    });
    res.json({ message: { role: "assistant", content: reply } });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Chat failed",
    });
  }
});

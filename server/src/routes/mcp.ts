import { Router } from "express";
import {
  clearMcpCache,
  getLastMcpLoadError,
  getMcpConfigJson,
  getMcpServersSummary,
  loadMcpToolBindings,
  setMcpConfigFromJson,
} from "../mcp/loadTools.js";

export const mcpRouter = Router();

mcpRouter.get("/config", (_req, res) => {
  res.json({ config: getMcpConfigJson() });
});

mcpRouter.post("/config", (req, res) => {
  const config = typeof req.body?.config === "string" ? req.body.config : "";
  setMcpConfigFromJson(config);
  res.json({ ok: true });
});

mcpRouter.get("/tools", async (_req, res) => {
  try {
    const tools = await loadMcpToolBindings();
    res.json({
      tools: tools.map((t) => ({
        name: t.toolName,
        description: t.description,
        serverName: t.serverName,
        approvalMode: t.approvalMode,
      })),
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to load MCP tools",
    });
  }
});

mcpRouter.get("/overview", async (_req, res) => {
  const tools = await loadMcpToolBindings();
  const servers = getMcpServersSummary();
  res.json({
    config: getMcpConfigJson(),
    servers,
    tools: tools.map((tool) => ({
      name: tool.toolName,
      description: tool.description,
      serverName: tool.serverName,
      approvalMode: tool.approvalMode,
    })),
    error: getLastMcpLoadError(),
  });
});

mcpRouter.post("/reload", (_req, res) => {
  clearMcpCache();
  res.json({ ok: true });
});

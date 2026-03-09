import "dotenv/config";
import express from "express";
import cors from "cors";
import { chatRouter } from "./routes/chat.js";
import { modelsRouter } from "./routes/models.js";
import { promptsRouter } from "./routes/prompts.js";
import { mcpRouter } from "./routes/mcp.js";

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors({ origin: true }));
app.use(express.json());

app.use("/api/chat", chatRouter);
app.use("/api/models", modelsRouter);
app.use("/api/prompts", promptsRouter);
app.use("/api/mcp", mcpRouter);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

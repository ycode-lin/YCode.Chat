import { Router } from "express";
import { BUILTIN_MODELS } from "../config/models.js";
import { getDefaultModelId } from "../config/llm.js";

export const modelsRouter = Router();

modelsRouter.get("/", (_req, res) => {
  res.json({
    models: BUILTIN_MODELS,
    defaultModelId: getDefaultModelId(),
  });
});

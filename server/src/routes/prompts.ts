import { Router } from "express";
import { BUILTIN_PROMPTS } from "../config/prompts.js";

export const promptsRouter = Router();

promptsRouter.get("/", (_req, res) => {
  res.json({ prompts: BUILTIN_PROMPTS });
});

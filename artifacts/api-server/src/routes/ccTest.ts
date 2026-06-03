import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { isCcUpstreamConfigured } from "../lib/ccUpstreamKeys.js";
import { getDefaultModel } from "../lib/models.js";
import { callCcClaudeCode } from "../providers/ccClaudeCode.js";
import type { ChatCompletionRequest, ChatCompletionResponse } from "../types.js";

const router = Router();

router.post("/api/cc/test", requireAuth, async (_req, res) => {
  if (!isCcUpstreamConfigured()) {
    res.status(400).json({ ok: false, error: "cc upstream API key is not configured" });
    return;
  }

  const model = getDefaultModel();
  const request: ChatCompletionRequest = {
    model,
    messages: [{ role: "user", content: "Reply with exactly: pong" }],
    stream: false,
  };

  try {
    const result = (await callCcClaudeCode(request)) as ChatCompletionResponse;
    const content = result.choices[0]?.message.content ?? "";
    res.json({ ok: content.trim() === "pong", model, content });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ ok: false, error: message });
  }
});

export default router;

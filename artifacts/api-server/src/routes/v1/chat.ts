import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../lib/auth.js";
import { resolveProvider, isModelDisabled, getDefaultModel } from "../../lib/models.js";
import { getSettings } from "../../lib/settings.js";
import { callCcClaudeCode } from "../../providers/ccClaudeCode.js";
import { logger } from "../../lib/logger.js";
import type { ChatCompletionRequest, ChatCompletionResponse, StreamChunk } from "../../types.js";

const MAX_ATTEMPTS = 3;

const router = Router();

router.post("/v1/chat/completions", requireAuth, async (req: Request, res: Response) => {
  // Allow up to 600 seconds for model generation
  res.setTimeout(600_000);
  req.socket.setTimeout(600_000);

  const body = req.body as ChatCompletionRequest;

  if (!body.messages || !Array.isArray(body.messages)) {
    res.status(400).json({ error: { message: "messages is required" } });
    return;
  }

  let model = body.model || getDefaultModel();

  if (isModelDisabled(model)) {
    res.status(400).json({ error: { message: `Model ${model} is disabled` } });
    return;
  }

  const provider = resolveProvider(model);
  if (!provider) {
    res.status(400).json({ error: { message: `Unknown model: ${model}` } });
    return;
  }

  const settings = getSettings();
  const messages = [...body.messages];

  if (
    settings.sillyTavernMode &&
    provider === "cc-claude-code" &&
    (!body.tools || body.tools.length === 0)
  ) {
    messages.push({ role: "user", content: "继续" });
  }

  const request: ChatCompletionRequest = { ...body, model, messages };

  async function callProvider() {
    switch (provider) {
      case "cc-claude-code": return callCcClaudeCode(request);
      default:                throw new Error("Unknown provider");
    }
  }

  let result: ChatCompletionResponse | AsyncIterable<StreamChunk> | undefined;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      result = await callProvider();
      break;
    } catch (err) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS) {
        logger.warn({ err, attempt, maxAttempts: MAX_ATTEMPTS, provider }, `attempt ${attempt} failed, retrying with next node`);
      } else {
        logger.error({ err, attempt, provider }, "all attempts exhausted");
      }
    }
  }

  if (result === undefined) {
    const message = lastErr instanceof Error ? lastErr.message : "Unknown error";
    req.log.error({ err: lastErr }, "Chat completion error after all retries");
    if (!res.headersSent) {
      res.status(502).json({ error: { message, type: "upstream_error" } });
    }
    return;
  }

  if (body.stream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    try {
      for await (const chunk of result as AsyncIterable<StreamChunk>) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      res.write("data: [DONE]\n\n");
    } catch (streamErr) {
      const message = streamErr instanceof Error ? streamErr.message : "Stream error";
      req.log.error({ err: streamErr }, "Stream error during chat completion");
      res.write(`data: ${JSON.stringify({ error: { message, type: "stream_error" } })}\n\n`);
    } finally {
      res.end();
    }
  } else {
    res.json(result);
  }
});

export default router;


import { Router } from "express";
import { requireAuth } from "../../lib/auth.js";
import { getCcUpstreamApiKey } from "../../lib/settings.js";
import { getEnabledModels, getAllModelsWithStatus, patchModelDisabled, refreshCcModels } from "../../lib/models.js";
import { logger } from "../../lib/logger.js";

const router = Router();

async function refreshModelsIfConfigured(): Promise<void> {
  const key = getCcUpstreamApiKey();
  if (!key) return;
  try {
    await refreshCcModels(key);
  } catch (err) {
    logger.warn({ err }, "Failed to refresh cc model list; using cached/default models");
  }
}

router.get("/v1/models", requireAuth, async (_req, res) => {
  await refreshModelsIfConfigured();
  const models = getEnabledModels();
  res.json({
    object: "list",
    data: models.map((m) => ({
      id: m.id,
      object: "model",
      created: m.created,
      owned_by: m.provider,
    })),
  });
});

router.get("/v1/admin/models", requireAuth, async (_req, res) => {
  await refreshModelsIfConfigured();
  const models = getAllModelsWithStatus();
  res.json({
    object: "list",
    data: models.map((m) => ({
      id: m.id,
      object: "model",
      created: m.created,
      owned_by: m.provider,
      provider: m.provider,
      disabled: m.disabled,
    })),
  });
});

router.patch("/v1/admin/models", requireAuth, (req, res) => {
  const body = req.body as { id?: string; disabled?: boolean; provider?: string; all_disabled?: boolean };

  if (body.provider !== undefined && body.all_disabled !== undefined) {
    const all = getAllModelsWithStatus();
    for (const m of all) {
      if (m.provider === body.provider) {
        patchModelDisabled(m.id, body.all_disabled);
      }
    }
    res.json({ ok: true });
    return;
  }

  if (!body.id || body.disabled === undefined) {
    res.status(400).json({ error: { message: "id and disabled are required" } });
    return;
  }
  patchModelDisabled(body.id, body.disabled);
  res.json({ ok: true });
});

export default router;

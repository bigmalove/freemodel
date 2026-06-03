import { Router } from "express";
import { getSettings } from "../lib/settings.js";
import { isCcUpstreamConfigured, peekNextCcKeyIndex } from "../lib/ccUpstreamKeys.js";

const router = Router();

router.get("/api/setup-status", (_req, res) => {
  const settings = getSettings();
  const cc = isCcUpstreamConfigured();
  const proxyKey = !!process.env["PROXY_API_KEY"];
  const reverseProxy = settings.reverseProxyEnabled && settings.ccUpstreamKeyPool.length > 0;

  res.json({
    configured: cc || proxyKey,
    providers: {
      cc,
      proxyKey,
    },
    providerSources: {
      "cc-claude-code": cc ? (reverseProxy ? "upstream" : "settings") : null,
    },
    reverseProxy,
    pool: {
      size: settings.ccUpstreamKeyPool.length,
      mode: settings.reverseProxyMode,
      nextIndex: peekNextCcKeyIndex(),
    },
    nodes: {
      active: settings.ccUpstreamKeyPool.map((e) => ({ id: e.id, type: "cc-api-key" })),
      disabled: settings.disabledCcUpstreamKeys.map((e) => ({
        id: e.id,
        disabledReason: e.disabledReason,
      })),
    },
  });
});

export default router;

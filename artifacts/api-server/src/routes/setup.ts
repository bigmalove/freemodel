import { Router } from "express";
import { getCcUpstreamApiKey } from "../lib/settings.js";

const router = Router();

router.get("/api/setup-status", (_req, res) => {
  const cc = !!getCcUpstreamApiKey();
  const proxyKey = !!process.env["PROXY_API_KEY"];
  res.json({
    configured: cc || proxyKey,
    providers: {
      cc,
      proxyKey,
    },
    providerSources: {
      "cc-claude-code": cc ? "settings" : null,
    },
    reverseProxy: false,
    pool: { size: 0, mode: "sticky", nextIndex: null },
    nodes: { active: [], disabled: [] },
  });
});

export default router;
